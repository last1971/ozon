import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { chunk } from 'lodash';
import { priceUpdateQueue, PricePlanStaleError, PricingSnapshot } from '../../helpers/price/price-update.queue';
import { assertPricingWritesAllowed } from '../../helpers/price/pricing-review-mode';
import { SerialTaskOptions } from '../../helpers/serial-task.queue';
import { AutoAction, UpdatePriceDto } from '../../price/dto/update.price.dto';
import { OzonPriceResult, ozonResultsByOffer } from '../../price/price-update.report';
import { ProductService } from '../../product/product.service';
import { OzonSellerActionsApi } from '../seller-actions.api';
import { effectiveMinimum, planOzonPrice } from './promo-price.planner';
import type { PromoPriceService } from './promo-price.service';
import {
    BaseStep,
    PercentStep,
    PromoPriceApplyResult,
    PromoPricePlan,
    PromoPriceState,
    PromoPriceStep,
} from './promo-price.types';
import { OZON_PROMO_STATE_READER } from './transition.tokens';

export interface PromoApplyOptions extends SerialTaskOptions {
    snapshot?: PricingSnapshot;
    assertCurrent?: () => void | Promise<void>;
    shouldStop?: () => boolean;
}

interface Job {
    plan: PromoPricePlan;
    options: PromoApplyOptions;
    /** Версии цен на момент чтения состояния: чужая запись после чтения делает план устаревшим. */
    read: PricingSnapshot;
}

interface Outcome {
    failures: Map<PromoPriceStep, string>;
    blocked?: string;
    stale?: boolean;
}

const BATCH = 100;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const hasAll = (row: UpdatePriceDto) =>
    [row.price, row.old_price, row.min_price].every(
        (v) => v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v)),
    );
const sameState = (a: PromoPriceState, b: PromoPriceState) =>
    a.productId === b.productId &&
    a.price === b.price &&
    a.minPrice === b.minPrice &&
    a.oldPrice === b.oldPrice &&
    (a.seller?.percent ?? null) === (b.seller?.percent ?? null) &&
    (a.seller?.isActive ?? null) === (b.seller?.isActive ?? null);

/**
 * Единственная запись цен Ozon: импорт цены (предельная, ограничение, зачёркнутая) и процент нашей акции,
 * пачками. В акции Ozon не пишет: с 12.10.2026 цена в акции и есть цена товара.
 */
@Injectable()
export class OzonPriceWriter {
    private readonly logger = new Logger(OzonPriceWriter.name);

    constructor(
        private readonly modules: ModuleRef,
        private readonly products: ProductService,
        private readonly seller: OzonSellerActionsApi,
    ) {}

    /** Цены пересчёта: из расчёта берём минимальную и зачёркнутую, предельную задаёт правило. */
    async updateBases(
        rows: UpdatePriceDto[],
        optionsFor: (offer: string) => PromoApplyOptions = () => ({}),
    ): Promise<OzonPriceResult[]> {
        const read = priceUpdateQueue.reader('ozon');
        const states = await this.statesOf(rows.map((r) => r.offer_id));
        const results = new Map<string, OzonPriceResult>();
        const blocked = (offer: string, reason: string) => {
            this.logger.warn(`[${offer}] ${reason}`);
            results.set(offer, {
                offer_id: offer,
                updated: false,
                transition: 'blocked',
                errors: [{ code: 'transition_blocked', message: reason }],
            });
        };
        const jobs: Job[] = [];
        for (const row of rows) {
            const state = states.get(row.offer_id);
            if (!state) {
                blocked(row.offer_id, 'Ozon не вернул состояние товара');
                continue;
            }
            if (!hasAll(row)) {
                blocked(row.offer_id, 'Для расчёта нужны базовая, минимальная и зачёркнутая цены');
                continue;
            }
            if (row.price_strategy_enabled === AutoAction.ENABLED) {
                blocked(row.offer_id, 'Стратегия цен Ozon меняла бы предельную цену сама');
                continue;
            }
            const { price, min_price, old_price, ozonCalculated, ozonDeadZoneFloor, ...rest } = row;
            const plan = planOzonPrice(
                state,
                effectiveMinimum(Number(min_price), ozonDeadZoneFloor),
                Number(old_price),
                rest,
            );
            if (!plan.ok) {
                blocked(row.offer_id, plan.notes.join('. ') || 'Цена ниже минимальной');
                continue;
            }
            jobs.push({
                plan,
                options: optionsFor(row.offer_id),
                read: read([row.offer_id, `#product:${state.productId}`]),
            });
        }
        const outcomes = await this.write(jobs);
        for (const { plan } of jobs) {
            const o = outcomes.get(plan.offerId);
            const reason = o.blocked ?? [...o.failures.values()].join('. ');
            if (reason) this.logger.warn(`[${plan.offerId}] ${reason}`);
            const row = rows.find((r) => r.offer_id === plan.offerId);
            results.set(plan.offerId, {
                offer_id: plan.offerId,
                updated: !reason,
                transition: reason ? 'blocked' : 'done',
                observedBuyerPrice: plan.buyerBefore,
                ...(plan.price !== Number(row.price) ? { effectiveBasePrice: plan.price } : {}),
                errors: reason
                    ? [{ code: o.stale ? 'transition_pending' : 'transition_blocked', message: reason }]
                    : [],
            });
        }
        return rows.map((r) => results.get(r.offer_id));
    }

    /** Планы сверки и ручного применения; Ozon перечитывается, изменившийся товар не трогаем. */
    async applyPlans(
        plans: PromoPricePlan[],
        optionsFor: (plan: PromoPricePlan) => PromoApplyOptions = () => ({}),
    ): Promise<PromoPriceApplyResult[]> {
        const read = priceUpdateQueue.reader('ozon');
        const withSteps = plans.filter((p) => p.steps.length);
        const states = await this.statesOf(withSteps.map((p) => p.offerId));
        const early = new Map<string, Outcome>();
        const jobs: Job[] = [];
        for (const plan of withSteps) {
            const state = states.get(plan.offerId);
            if (!state || !sameState(state, plan.state)) {
                early.set(plan.offerId, {
                    failures: new Map(),
                    blocked: state ? 'Цена Ozon изменилась после подготовки плана' : 'Ozon не вернул состояние товара',
                    stale: Boolean(state),
                });
                continue;
            }
            jobs.push({ plan, options: optionsFor(plan), read: read([plan.offerId, `#product:${state.productId}`]) });
        }
        const outcomes = await this.write(jobs);
        return plans.map((plan) => {
            const o = outcomes.get(plan.offerId) ?? early.get(plan.offerId);
            if (!o) return { ...plan, results: [], applied: true, attempted: false };
            const sent = !o.blocked;
            const reason = o.blocked ?? [...o.failures.values()].join('. ');
            return {
                ...plan,
                ok: plan.ok && !o.blocked,
                applied: sent && !o.failures.size,
                attempted: sent,
                ...(o.stale ? { stale: true } : {}),
                results: sent
                    ? plan.steps.map((step) =>
                          o.failures.has(step)
                              ? { step, status: 'rejected' as const, reason: o.failures.get(step) }
                              : { step, status: 'ok' as const, changed: true },
                      )
                    : [],
                notes: reason ? [...plan.notes, reason] : plan.notes,
            };
        });
    }

    private reader() {
        return this.modules.get<PromoPriceService>(OZON_PROMO_STATE_READER, { strict: false });
    }

    private async statesOf(offers: string[]): Promise<Map<string, PromoPriceState>> {
        if (!offers.length) return new Map();
        return new Map((await this.reader().pricedStates(offers)).map((s) => [s.offerId, s]));
    }

    private async write(jobs: Job[]): Promise<Map<string, Outcome>> {
        const out = new Map<string, Outcome>();
        if (!jobs.length) return out;
        assertPricingWritesAllowed();
        const priority = jobs.some((j) => j.options.priority === 'manual') ? 'manual' : 'background';
        await priceUpdateQueue.run(
            'ozon',
            async () => {
                const ready: Job[] = [];
                for (const job of jobs) {
                    const o: Outcome = { failures: new Map() };
                    out.set(job.plan.offerId, o);
                    try {
                        if (job.options.shouldStop?.()) throw new Error('Задача остановлена');
                        await job.options.assertCurrent?.();
                        if (job.options.snapshot) priceUpdateQueue.assertCurrent(job.options.snapshot);
                        priceUpdateQueue.assertCurrent(job.read);
                        ready.push(job);
                    } catch (error) {
                        Object.assign(o, { blocked: message(error), stale: error instanceof PricePlanStaleError });
                    }
                }
                try {
                    await this.send(ready, out);
                } finally {
                    if (ready.length) {
                        priceUpdateQueue.changed(
                            'ozon',
                            ready.flatMap((j) => [j.plan.offerId, `#product:${j.plan.productId}`]),
                        );
                        this.reader().forget(ready.map((j) => j.plan.productId));
                    }
                }
            },
            { priority, onWaiting: jobs[0].options.onWaiting },
        );
        return out;
    }

    private async send(jobs: Job[], out: Map<string, Outcome>) {
        type Item = { job: Job; step: PromoPriceStep };
        const all: Item[] = jobs.flatMap((job) => job.plan.steps.map((step) => ({ job, step })));
        const fail = (x: Item, reason: string) => out.get(x.job.plan.offerId).failures.set(x.step, reason);
        const guarded = async (part: Item[], call: () => Promise<void>) => {
            try {
                await call();
            } catch (error) {
                part.forEach((x) => fail(x, `Ответ Ozon не получен: ${message(error)}`));
            }
        };

        // Процент первым: он не ниже минимального, по нему уже посчитана предельная цена.
        const byAction = new Map<number, Item[]>();
        for (const x of all.filter((i) => i.step.kind === 'percent')) {
            const id = (x.step as PercentStep).actionId;
            byAction.set(id, [...(byAction.get(id) ?? []), x]);
        }
        for (const [actionId, list] of byAction)
            for (const part of chunk(list, BATCH))
                await guarded(part, async () => {
                    const steps = part.map((x) => x.step as PercentStep);
                    const res = await this.seller.setPercent(
                        actionId,
                        steps.map((s) => ({ sku: s.sku, percent: s.to })),
                    );
                    const rejected = new Map(res.rejected.map((r) => [r.sku, r.reason]));
                    part.forEach((x, i) => {
                        const sku = steps[i].sku;
                        if (rejected.has(sku)) fail(x, rejected.get(sku));
                        else if (!res.applied.some((p) => p.sku === sku)) fail(x, 'Ozon не подтвердил процент');
                    });
                });

        for (const part of chunk(
            all.filter((x) => x.step.kind === 'base'),
            BATCH,
        ))
            await guarded(part, async () => {
                const rows = ozonResultsByOffer(
                    await this.products.setPrice({ prices: part.map((x) => (x.step as BaseStep).target) }),
                );
                for (const x of part) {
                    const row = rows.get(x.job.plan.offerId);
                    if (!row?.updated || row.errors?.length)
                        fail(
                            x,
                            row?.errors?.map((e) => e.message || e.code).join(', ') || 'Ozon не подтвердил импорт цены',
                        );
                }
            });
    }
}
