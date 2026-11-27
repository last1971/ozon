import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { chunk } from 'lodash';
import { priceUpdateQueue, PricePlanStaleError, PricingSnapshot } from '../../helpers/price/price-update.queue';
import { assertPricingWritesAllowed } from '../../helpers/price/pricing-review-mode';
import { SerialTaskOptions } from '../../helpers/serial-task.queue';
import { AutoAction, UpdatePriceDto } from '../../price/dto/update.price.dto';
import { OzonPriceResult, ozonResultsByOffer } from '../../price/price-update.report';
import { ProductService } from '../../product/product.service';
import { OzonPromosApi } from '../promos.api';
import { OzonSellerActionsApi } from '../seller-actions.api';
import { planBaseUpdate, stepsToSend } from './promo-price.planner';
import type { PromoPriceService } from './promo-price.service';
import {
    BaseStep,
    PriceStep,
    PromoPriceApplyResult,
    PromoPricePlan,
    PromoPriceState,
    PromoPriceStep,
    PromoStepResult,
} from './promo-price.types';
import { BuildSweepReportCommand } from './sweep/build-sweep-report.command';
import { OZON_PROMO_SWEEP_EVENT } from './sweep/notify-sweep.command';
import type { IPromoSweepContext } from './sweep/promo-sweep.context';
import { verifySweepChanges } from './sweep/verify-sweep-changes';
import { OZON_PROMO_STATE_READER } from './transition.tokens';

export interface PromoApplyOptions extends SerialTaskOptions {
    snapshot?: PricingSnapshot;
    assertCurrent?: () => void | Promise<void>;
    notify?: boolean;
    shouldStop?: () => boolean;
}

interface Job {
    offer: string;
    state: PromoPriceState;
    steps: PriceStep[];
    minimum: number;
    deadZoneFloor?: number;
    options: PromoApplyOptions;
    /** Версии цен на момент чтения состояния: чужая запись после чтения делает план устаревшим. */
    read: PricingSnapshot;
}

interface Outcome {
    sent: PriceStep[];
    deferred: PriceStep[];
    failures: Map<PriceStep, string>;
    blocked?: string;
    stale?: boolean;
}

const BATCH = 100;
const DEFERRED = 'Сначала поднимаем цену покупателю, снижение — следующим проходом';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const hasAll = (row: UpdatePriceDto) =>
    [row.price, row.old_price, row.min_price].every(
        (v) => v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v)),
    );

/**
 * Единственная запись цен и акций в Ozon. Один снимок на пачку, шаги одного направления за проход
 * (stepsToSend), отправка пачками. Подтверждения не ждём: следующий проход читает Ozon и считает заново.
 */
@Injectable()
export class OzonPriceWriter {
    private readonly logger = new Logger(OzonPriceWriter.name);

    constructor(
        private readonly modules: ModuleRef,
        private readonly products: ProductService,
        private readonly actions: OzonPromosApi,
        private readonly seller: OzonSellerActionsApi,
        private readonly events: EventEmitter2,
    ) {}

    async updateBases(
        rows: UpdatePriceDto[],
        optionsFor: (offer: string) => PromoApplyOptions = () => ({}),
    ): Promise<OzonPriceResult[]> {
        const read = priceUpdateQueue.reader('ozon');
        const states = await this.statesOf(rows.map((r) => r.offer_id));
        const results = new Map<string, OzonPriceResult>();
        const blocked = (offer: string, reason: string) =>
            results.set(offer, {
                offer_id: offer,
                updated: false,
                transition: 'blocked',
                errors: [{ code: 'transition_blocked', message: reason }],
            });
        const jobs: Job[] = [];
        const targets = new Map<string, UpdatePriceDto>();
        const plans = new Map<string, PromoPricePlan>();
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
            const enables = row.auto_action_enabled === AutoAction.ENABLED;
            if (
                (row.auto_action_enabled &&
                    row.auto_action_enabled !== AutoAction.UNKNOWN &&
                    state.autoActionEnabled !== enables) ||
                row.price_strategy_enabled === AutoAction.ENABLED
            ) {
                blocked(
                    row.offer_id,
                    'Импорт изменил бы автоматическое управление акциями или ценой. Итог Ozon нельзя рассчитать заранее',
                );
                continue;
            }
            const planned = planBaseUpdate(state, row);
            targets.set(row.offer_id, planned.target);
            plans.set(row.offer_id, planned.plan);
            jobs.push({
                offer: row.offer_id,
                state,
                steps: planned.steps,
                minimum: planned.minimum,
                deadZoneFloor: planned.deadZoneFloor,
                options: optionsFor(row.offer_id),
                read: read([row.offer_id, `#product:${state.productId}`]),
            });
        }
        const outcomes = await this.write(jobs);
        await this.notify(
            jobs.flatMap((job) => {
                const o = outcomes.get(job.offer);
                const steps = o.sent.filter((s): s is PromoPriceStep => s.kind !== 'base');
                if (!steps.length || o.blocked || o.failures.size) return [];
                return [{
                    ...plans.get(job.offer),
                    state: job.state,
                    buyerBefore: job.state.buyerPrice,
                    steps,
                    results: steps.map((step) => ({ step, status: 'ok' as const, changed: true })),
                    applied: true,
                    attempted: true,
                }];
            }),
        );
        for (const job of jobs) {
            const o = outcomes.get(job.offer);
            const failed = [...o.failures.values()];
            const status = o.blocked || failed.length ? 'blocked' : o.deferred.length ? 'pending' : 'done';
            let reason = o.blocked ?? (failed.length ? failed.join('. ') : o.deferred.length ? DEFERRED : undefined);
            if (reason && job.state.buyerPrice > 0 && job.state.buyerPrice < job.minimum)
                reason = `${job.offer}: цена покупателю ${job.state.buyerPrice} ₽ ниже минимума ${job.minimum} ₽. ${reason}`;
            if (status !== 'done') this.logger.warn(`[${job.offer}] ${status}: ${reason}`);
            const target = targets.get(job.offer);
            const row = rows.find((r) => r.offer_id === job.offer);
            results.set(job.offer, {
                offer_id: job.offer,
                updated: status === 'done',
                transition: status,
                observedBuyerPrice: job.state.buyerPrice,
                ...(Number(target.price) !== Number(row.price) ? { effectiveBasePrice: Number(target.price) } : {}),
                errors:
                    status === 'done'
                        ? []
                        : [
                              {
                                  code: status === 'pending' ? 'transition_pending' : 'transition_blocked',
                                  message: reason,
                              },
                          ],
            });
        }
        return rows.map((r) => results.get(r.offer_id));
    }

    async applyPromo(plan: PromoPricePlan, options: PromoApplyOptions = {}): Promise<PromoPriceApplyResult> {
        return (await this.applyPromos([plan], () => options))[0];
    }

    async applyPromos(
        plans: PromoPricePlan[],
        optionsFor: (plan: PromoPricePlan) => PromoApplyOptions = () => ({}),
    ): Promise<PromoPriceApplyResult[]> {
        const withSteps = plans.filter((p) => p.steps.length);
        const read = priceUpdateQueue.reader('ozon');
        const states = withSteps.length ? await this.statesOf(withSteps.map((p) => p.offerId)) : new Map();
        const early = new Map<string, Outcome>();
        const jobs: Job[] = [];
        for (const plan of withSteps) {
            const state = states.get(plan.offerId);
            const before = plan.state;
            if (!state || state.productId !== plan.productId) {
                early.set(plan.offerId, { sent: [], deferred: [], failures: new Map(), blocked: 'Ozon не вернул состояние товара' });
                continue;
            }
            if (
                state.price !== before.price ||
                state.minPrice !== before.minPrice ||
                state.oldPrice !== before.oldPrice ||
                state.buyerPrice !== before.buyerPrice
            ) {
                early.set(plan.offerId, {
                    sent: [],
                    deferred: [],
                    failures: new Map(),
                    blocked: 'Цена Ozon изменилась после подготовки плана',
                    stale: true,
                });
                continue;
            }
            jobs.push({
                offer: plan.offerId,
                state,
                steps: plan.steps,
                minimum: before.calcMinPrice ?? before.minPrice,
                deadZoneFloor: before.deadZoneFloor,
                options: optionsFor(plan),
                read: read([plan.offerId, `#product:${state.productId}`]),
            });
        }
        const outcomes = await this.write(jobs);
        return plans.map((plan) => {
            const o = outcomes.get(plan.offerId) ?? early.get(plan.offerId);
            if (!o) return { ...plan, results: [], applied: true, attempted: false };
            const results: PromoStepResult[] = [
                ...(o.sent as PromoPriceStep[]).map((step) =>
                    o.failures.has(step)
                        ? { step, status: 'rejected' as const, reason: o.failures.get(step) }
                        : { step, status: 'ok' as const, changed: true },
                ),
                ...(o.deferred as PromoPriceStep[]).map((step) => ({ step, status: 'skipped' as const, reason: DEFERRED })),
            ];
            const reason = o.blocked ?? (o.failures.size ? [...o.failures.values()].join('. ') : o.deferred.length ? DEFERRED : undefined);
            return {
                ...plan,
                ok: plan.ok && !o.blocked,
                applied: !o.blocked && !o.failures.size,
                attempted: o.sent.length > 0,
                ...(o.stale ? { stale: true } : {}),
                results,
                notes: reason ? [...plan.notes, reason] : plan.notes,
            };
        });
    }

    /** Акции, изменённые вместе с базой, попадают в тот же отчёт «цены», что и сверка, — после чтения Ozon. */
    private async notify(results: PromoPriceApplyResult[]) {
        if (!results.length) return;
        try {
            await verifySweepChanges(results, this.reader());
            const confirmed = results.filter((r) => r.verification === 'confirmed');
            if (!confirmed.length) return;
            const context = {
                apply: true,
                goal: 'min',
                plans: confirmed,
                results: confirmed,
                checked: confirmed.length,
                progress: { done: 0, counters: {} },
            } as unknown as IPromoSweepContext;
            await new BuildSweepReportCommand().execute(context);
            await this.events.emitAsync(OZON_PROMO_SWEEP_EVENT, context.report);
        } catch (error) {
            this.logger.warn(`Отчёт об изменении акций не отправлен: ${message(error)}`);
        }
    }

    private reader() {
        return this.modules.get<PromoPriceService>(OZON_PROMO_STATE_READER, { strict: false });
    }

    private async statesOf(offers: string[]): Promise<Map<string, PromoPriceState>> {
        if (!offers.length) return new Map();
        const states = await this.reader().allStates(offers);
        return new Map(states.map((s) => [s.offerId, s]));
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
                    const { send, deferred } = stepsToSend(job.state, job.steps, job.minimum, job.deadZoneFloor);
                    const o: Outcome = { sent: [], deferred, failures: new Map() };
                    out.set(job.offer, o);
                    try {
                        if (job.options.shouldStop?.()) throw new Error('Задача остановлена');
                        await job.options.assertCurrent?.();
                        if (job.options.snapshot) priceUpdateQueue.assertCurrent(job.options.snapshot);
                        priceUpdateQueue.assertCurrent(job.read);
                    } catch (error) {
                        Object.assign(o, { blocked: message(error), stale: error instanceof PricePlanStaleError, deferred: [] });
                        continue;
                    }
                    o.sent = send;
                    if (send.length) ready.push(job);
                }
                try {
                    await this.send(ready, out);
                } finally {
                    if (ready.length) {
                        priceUpdateQueue.changed('ozon', ready.flatMap((j) => [j.offer, `#product:${j.state.productId}`]));
                        this.reader().forget(ready.map((j) => j.state.productId));
                    }
                }
            },
            { priority, onWaiting: jobs[0].options.onWaiting },
        );
        return out;
    }

    private async send(jobs: Job[], out: Map<string, Outcome>) {
        const all = jobs.flatMap((job) => out.get(job.offer).sent.map((step) => ({ job, step })));
        const fail = (x: { job: Job; step: PriceStep }, reason: string) => out.get(x.job.offer).failures.set(x.step, reason);
        const guarded = async <T extends { job: Job; step: PriceStep }>(part: T[], call: () => Promise<void>) => {
            try {
                await call();
            } catch (error) {
                part.forEach((x) => fail(x, `Ответ Ozon не получен: ${message(error)}`));
            }
        };

        for (const part of chunk(all.filter((x) => x.step.kind === 'base'), BATCH))
            await guarded(part, async () => {
                const rows = ozonResultsByOffer(
                    await this.products.setPrice({ prices: part.map((x) => (x.step as BaseStep).target) }),
                );
                for (const x of part) {
                    const row = rows.get(x.job.offer);
                    if (!row?.updated || row.errors?.length)
                        fail(x, row?.errors?.map((e) => e.message || e.code).join(', ') || 'Ozon не подтвердил импорт цены');
                }
            });

        type Item = (typeof all)[number];
        const byAction = (items: Item[]) => {
            const groups = new Map<number, Item[]>();
            for (const x of items) {
                const id = (x.step as PromoPriceStep).actionId;
                groups.set(id, [...(groups.get(id) ?? []), x]);
            }
            return groups;
        };

        for (const list of byAction(all.filter((x) => x.step.kind === 'percent')).values())
            for (const part of chunk(list, BATCH))
                await guarded(part, async () => {
                    const steps = part.map((x) => x.step as Extract<PriceStep, { kind: 'percent' }>);
                    const res = await this.seller.setPercent(
                        steps[0].actionId,
                        steps.map((s) => ({ sku: s.sku, percent: s.to })),
                    );
                    const rejected = new Map(res.rejected.map((r) => [r.sku, r.reason]));
                    part.forEach((x, i) => {
                        const sku = steps[i].sku;
                        if (rejected.has(sku)) fail(x, rejected.get(sku));
                        else if (!res.applied.some((p) => p.sku === sku)) fail(x, 'Ozon не подтвердил процент');
                    });
                });

        const campaign = all.filter((x) => x.step.kind === 'ozon-set' || x.step.kind === 'ozon-remove');
        for (const [actionId, list] of byAction(campaign)) {
            const slotOf = (x: Item) => x.job.state.ozonActions.find((a) => a.actionId === actionId);
            const vouchers = list.filter((x) => x.step.kind === 'ozon-remove' && slotOf(x)?.isVoucher);
            for (const part of chunk(vouchers, BATCH))
                await guarded(part, async () => {
                    const removed = await this.actions.deactivate(actionId, part.map((x) => x.job.state.productId));
                    part.filter((x) => !removed.includes(x.job.state.productId)).forEach((x) => fail(x, 'Ozon не исключил товар из акции'));
                });
            for (const part of chunk(list.filter((x) => !vouchers.includes(x)), BATCH))
                await guarded(part, async () => {
                    const res = await this.actions.update(
                        actionId,
                        part.map((x) => {
                            const slot = slotOf(x);
                            const step = x.step as Extract<PriceStep, { kind: 'ozon-set' | 'ozon-remove' }>;
                            // Цена выше предельной — Ozon исключает товар из акции.
                            return step.kind === 'ozon-set'
                                ? { productId: x.job.state.productId, actionPrice: step.to, stock: step.stock ?? slot?.stock ?? 0 }
                                : { productId: x.job.state.productId, actionPrice: Math.max(1, (slot?.maxActionPrice ?? 0) + 1), stock: slot?.stock ?? 0 };
                        }),
                    );
                    const rejected = new Map(res.rejected.map((r) => [r.productId, r.reason]));
                    for (const x of part) {
                        const id = x.job.state.productId;
                        if (rejected.has(id)) fail(x, rejected.get(id));
                        else if (x.step.kind === 'ozon-remove' && (res.added.includes(id) || res.unchanged.includes(id)))
                            fail(x, `Ozon оставил товар в акции «${(x.step as PromoPriceStep & { title: string }).title}»`);
                        else if (![...res.added, ...res.removed, ...res.unchanged].includes(id))
                            fail(x, 'Ответ акции Ozon не содержит результат товара');
                    }
                });
        }
    }
}
