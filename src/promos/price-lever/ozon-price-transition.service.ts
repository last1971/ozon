import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { priceUpdateQueue, PricePlanStaleError } from '../../helpers/price/price-update.queue';
import { assertPricingWritesAllowed } from '../../helpers/price/pricing-review-mode';
import { resolveOzonBaseTarget } from '../../helpers/price/ozon-base-target';
import { ozonDisplayPrice } from '../../helpers/price/ozon.display-price';
import { AutoAction, UpdatePriceDto } from '../../price/dto/update.price.dto';
import { OzonPriceResult, ozonResultsByOffer } from '../../price/price-update.report';
import { ProductService } from '../../product/product.service';
import { OzonPromosApi } from '../promos.api';
import { OzonSellerActionsApi } from '../seller-actions.api';
import type { PromoApplyOptions } from './promo-price.applier';
import { OZON_PROMO_STATE_READER } from './transition.tokens';
import type { PromoPriceService } from './promo-price.service';
import { PromoPriceApplyResult, PromoPricePlan, PromoPriceState, PromoStepResult } from './promo-price.types';
import { planPromoPrice } from './promo-price.planner';
import {
    observedOzonBase,
    OzonTransitionStep,
    planOzonPriceTransition,
    transitionStepConfirmed,
} from './ozon-price-transition';
import { OzonBaseReceipt, OzonTransitionJournal } from './ozon-transition-journal';
import { EnrichWithPricingCommand } from './sweep/enrich-with-pricing.command';

type Goal = UpdatePriceDto | PromoPricePlan;
type Pending = {
    goal: Goal;
    requested?: UpdatePriceDto;
    initial: PromoPriceState;
    step: OzonTransitionStep;
    baseAccepted?: boolean;
    calculationKey: string;
    results: PromoStepResult[];
    notify: boolean;
    alternative?: 'removed' | 'kept';
};
type Outcome = {
    status: 'done' | 'pending' | 'blocked';
    reason?: string;
    results: PromoStepResult[];
    observed?: number;
    attempted?: boolean;
    effectiveBasePrice?: number;
    stale?: boolean;
};
type Request = { offer: string; goal: Goal; options: PromoApplyOptions; recovery?: boolean };

const pending = (reason: string, results: PromoStepResult[] = []): Outcome => ({ status: 'pending', reason, results });
const blocked = (reason: string): Outcome => ({ status: 'blocked', reason, results: [] });
const isBase = (goal: Goal): goal is UpdatePriceDto => 'offer_id' in goal;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function sameGoal(left: Goal, right: Goal) {
    if (isBase(left) && isBase(right))
        return (
            left.offer_id === right.offer_id &&
            Number(left.price) === Number(right.price) &&
            Number(left.min_price) === Number(right.min_price) &&
            Number(left.old_price) === Number(right.old_price) &&
            left.vat === right.vat &&
            left.auto_action_enabled === right.auto_action_enabled &&
            left.price_strategy_enabled === right.price_strategy_enabled
        );
    if (isBase(left) || isBase(right)) return false;
    return (
        left.productId === right.productId &&
        left.target === right.target &&
        left.percent === right.percent &&
        left.buyerAfter === right.buyerAfter &&
        JSON.stringify(left.steps) === JSON.stringify(right.steps)
    );
}

function promoResult(goal: PromoPricePlan, result: Outcome): PromoPriceApplyResult {
    return {
        ...goal,
        ok: goal.ok && result.status !== 'blocked',
        applied: result.status === 'done',
        attempted: result.attempted ?? result.results.length > 0,
        stale: result.stale,
        verification:
            result.status === 'pending'
                ? 'pending'
                : result.status === 'done'
                  ? result.results.some((r) => r.changed)
                      ? 'confirmed'
                      : 'unchanged'
                  : undefined,
        observedBuyerPrice: result.observed,
        results: result.results,
        notes: result.reason ? [...goal.notes, result.reason] : goal.notes,
    };
}

@Injectable()
export class OzonPriceTransitionService {
    private readonly logger = new Logger(OzonPriceTransitionService.name);
    constructor(
        private readonly modules: ModuleRef,
        private readonly pricing: EnrichWithPricingCommand,
        private readonly journal: OzonTransitionJournal,
        private readonly products: ProductService,
        private readonly actions: OzonPromosApi,
        private readonly seller: OzonSellerActionsApi,
    ) {}

    async updateBases(rows: UpdatePriceDto[]): Promise<OzonPriceResult[]> {
        const requests = rows.map((row) => ({ offer: row.offer_id, goal: row, options: {} }));
        const answers = await this.run(requests);
        return requests.map(({ offer, goal }) => {
            const res = answers.get(offer);
            if (res.status !== 'done')
                this.logger.warn(`[${offer}] transition ${res.status}: ${res.reason ?? '(без причины)'}`);
            return {
                offer_id: offer,
                updated: res.status === 'done',
                transition: res.status,
                ...(res.effectiveBasePrice !== undefined && res.effectiveBasePrice !== Number(goal.price)
                    ? { effectiveBasePrice: res.effectiveBasePrice }
                    : {}),
                errors:
                    res.status === 'done'
                        ? []
                        : [
                              {
                                  code: res.status === 'pending' ? 'transition_pending' : 'transition_blocked',
                                  message: res.reason,
                              },
                          ],
            };
        });
    }

    async applyPromo(plan: PromoPricePlan, options: PromoApplyOptions = {}) {
        return (await this.applyPromos([plan], () => options))[0];
    }

    async applyPromos(plans: PromoPricePlan[], optionsFor: (plan: PromoPricePlan) => PromoApplyOptions) {
        const results = await this.run(plans.map((goal) => ({ offer: goal.offerId, goal, options: optionsFor(goal) })));
        return plans.map((goal) => promoResult(goal, results.get(goal.offerId)));
    }

    async resume(offers?: string[]) {
        const allowed = offers && new Set(offers);
        const claims = await this.journal.outstanding<Pending>();
        const requests: Request[] = [];
        for (const [offer, claim] of claims) {
            if (!allowed || allowed.has(offer))
                requests.push({ offer, goal: claim.payload.goal, options: {}, recovery: true });
        }
        for (const [offer, result] of await this.run(requests)) {
            if (result.reason) this.logger.warn(`${offer}: ${result.reason}`);
        }
    }

    private async run(requests: Request[]) {
        const answers = new Map<string, Outcome>();
        if (!requests.length) return answers;
        assertPricingWritesAllowed();
        const byOffer = new Map<string, Request>();
        for (const request of requests) {
            if (request.options.shouldStop?.()) answers.set(request.offer, blocked('Задача остановлена'));
            if (byOffer.has(request.offer)) answers.set(request.offer, blocked('Артикул повторяется в одном запросе'));
            byOffer.set(request.offer, request);
            if (!isBase(request.goal) && !request.goal.ok)
                answers.set(request.offer, blocked('План не обеспечивает минимальную прибыль'));
        }
        let active = [...byOffer.values()].filter((r) => !answers.has(r.offer));
        // One snapshot of BOTH action lists per round, shared by every offer in the batch.
        // A slow response yields to the next scheduled run, which reads the durable intent.
        const limit = Math.max(4, ...active.map((r) => (isBase(r.goal) ? 32 : r.goal.steps.length + 5)));
        for (let wave = 0; active.length && wave < limit; wave++) {
            const next: Request[] = [];
            const reader = this.modules.get<PromoPriceService>(OZON_PROMO_STATE_READER, { strict: false });
            const snapshot = priceUpdateQueue.reader('ozon');
            let states: PromoPriceState[];
            let versions: Map<string, string>;
            try {
                const offers = active.map((r) => r.offer);
                versions = await this.journal.versions(offers);
                states = await reader.allStates(offers);
                const pricingErrors = await this.pricing.enrichBatch(states);
                for (const [offerId, err] of pricingErrors)
                    this.logger.warn(`[${offerId}] Не удалось рассчитать минимальную цену: ${err}`);
            } catch (error) {
                for (const r of active)
                    answers.set(
                        r.offer,
                        pending(`Не удалось проверить актуальную цену и тарифы Ozon: ${message(error)}`),
                    );
                active = [];
                break;
            }
            const byId = new Map(states.map((state) => [state.offerId, state]));
            for (const request of active) {
                const state = byId.get(request.offer);
                let result: Outcome | undefined;
                try {
                    result = await priceUpdateQueue.run(
                        'ozon',
                        async () => {
                            if (request.options.shouldStop?.()) return blocked('Задача остановлена');
                            await request.options.assertCurrent?.();
                            if (!wave && request.options.snapshot)
                                priceUpdateQueue.assertCurrent(request.options.snapshot);
                            const scopes = state ? [request.offer, `#product:${state.productId}`] : [request.offer];
                            priceUpdateQueue.assertCurrent(snapshot(scopes));
                            return this.tick(request, state, wave, versions.get(request.offer) ?? null);
                        },
                        request.options,
                    );
                } catch (error) {
                    result =
                        error instanceof PricePlanStaleError
                            ? wave || isBase(request.goal)
                                ? pending(message(error))
                                : { ...blocked(message(error)), stale: true }
                            : pending(message(error));
                }
                if (result) answers.set(request.offer, result);
                else next.push(request);
            }
            active = next;
        }
        for (const r of active) answers.set(r.offer, pending('Продолжение сохранено до следующей сверки Ozon'));
        return answers;
    }

    private async tick(
        request: Request,
        state: PromoPriceState,
        wave: number,
        version: string | null,
    ): Promise<Outcome | undefined> {
        const { offer, options } = request;
        let { goal } = request;
        const claim = await this.journal.pending<Pending>(offer);
        if (claim && claim.token !== version) return pending('Состояние операции изменилось во время чтения цен');
        if (!state) return pending('Ozon не вернул состояние товара');
        let confirmedBase = observedOzonBase(state) ?? state.confirmedBase;
        let results: PromoStepResult[] = [];
        if (isBase(goal)) {
            if (
                ![goal.price, goal.old_price, goal.min_price].every(
                    (v) => v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v)),
                )
            )
                return blocked('Для расчёта перехода нужны базовая, минимальная и зачёркнутая цены');
            goal = resolveOzonBaseTarget(goal, state);
            goal = { ...goal, old_price: String(ozonDisplayPrice(Number(goal.price), Number(goal.old_price))) };
        }
        if (claim) {
            const saved = claim.payload;
            if (saved.alternative && saved.step.change.kind !== 'base' && saved.step.change.kind !== 'percent') {
                const change = saved.step.change;
                const slot = state.ozonActions.find((a) => a.actionId === change.actionId);
                const seen =
                    saved.alternative === 'removed'
                        ? !slot?.participant
                        : slot?.participant && slot.actionPrice === saved.step.floor;
                if (
                    seen &&
                    state.productId === saved.step.productId &&
                    state.buyerPrice > 0 &&
                    state.buyerPrice === state.buyerPriceCalc
                ) {
                    await this.journal.finish(offer, claim.token);
                    return blocked(
                        'Ozon изменил участие в акции иначе, чем запрошено. Последующие шаги остановлены до нового расчёта',
                    );
                }
            }
            const maskedImport = saved.step.change.kind === 'base' && observedOzonBase(state) === undefined;
            if ((maskedImport && !saved.baseAccepted) || !transitionStepConfirmed(state, saved.step))
                return {
                    ...pending('Ждём подтверждения цены и акции от Ozon', saved.results),
                    observed: state.buyerPrice,
                    attempted: true,
                };
            confirmedBase = saved.step.change.kind === 'base' ? Number(saved.step.change.target.price) : confirmedBase;
            confirmedBase = observedOzonBase(state) ?? confirmedBase;
            state.confirmedBase = confirmedBase;
            results = [...saved.results];
            if (saved.step.change.kind !== 'base')
                results.push({ step: saved.step.change, status: 'ok', changed: true });
            if (!sameGoal(saved.goal, goal)) {
                if (request.recovery || (saved.requested && sameGoal(saved.requested, request.goal))) {
                    await this.journal.finish(offer, claim.token);
                    return {
                        ...blocked('Шаг подтверждён, но условия скидки изменились. Требуется новый расчёт'),
                        stale: true,
                    };
                }
                return pending('Другая операция ожидает завершения по этому товару');
            }
            if (state.calculationKey && state.calculationKey !== saved.calculationKey) {
                await this.journal.finish(offer, claim.token);
                return {
                    ...blocked('Предыдущий шаг подтверждён. Цель или условия расчёта изменились, требуется новый план'),
                    stale: true,
                };
            }
            goal = saved.goal;
        } else if (request.recovery || wave) {
            return blocked('Операция уже завершена другим исполнителем');
        }
        if (!state.calcMinPrice || !state.calculationKey)
            return blocked('Нет остатка или полного расчёта минимальной прибыли');
        if (
            !isBase(goal) &&
            !claim &&
            (state.price !== goal.state.price ||
                state.minPrice !== goal.state.minPrice ||
                state.oldPrice !== goal.state.oldPrice ||
                state.buyerPrice !== goal.state.buyerPrice)
        ) {
            return { ...blocked('Цена Ozon изменилась после подготовки плана'), stale: true };
        }
        const baseReceipt: OzonBaseReceipt | undefined =
            confirmedBase === undefined
                ? undefined
                : {
                      price: confirmedBase,
                      minPrice: state.minPrice,
                      oldPrice: state.oldPrice,
                      productId: state.productId,
                  };
        const path = planOzonPriceTransition(state, goal, new Date(), confirmedBase);
        if (isBase(goal)) {
            const enables = goal.auto_action_enabled === AutoAction.ENABLED;
            if (
                (goal.auto_action_enabled &&
                    goal.auto_action_enabled !== AutoAction.UNKNOWN &&
                    state.autoActionEnabled !== enables) ||
                goal.price_strategy_enabled === AutoAction.ENABLED
            ) {
                if (claim) await this.journal.finish(offer, claim.token);
                return blocked(
                    'Импорт изменил бы автоматическое управление акциями или ценой. Итог Ozon нельзя рассчитать заранее',
                );
            }
        }
        if (!path.ok || !path.steps.length) {
            const result: Outcome = {
                status: path.ok ? 'done' : 'blocked',
                results,
                observed: state.buyerPrice,
                reason: path.reason,
                effectiveBasePrice: isBase(goal) ? Number(goal.price) : undefined,
            };
            let notice: PromoPriceApplyResult | undefined;
            if (path.ok) {
                const final = isBase(goal)
                    ? planPromoPrice(
                          { ...state, price: Number(goal.price), minPrice: Number(goal.min_price) },
                          Math.max(Number(goal.min_price), state.calcMinPrice),
                      )
                    : goal;
                if (state.buyerPrice !== final.buyerAfter)
                    return {
                        ...pending('Участие в акции подтверждено, ждём фактической итоговой цены Ozon', results),
                        observed: state.buyerPrice,
                    };
                if (claim?.payload.notify && results.length) {
                    const initial = claim.payload.initial;
                    notice = promoResult(
                        {
                            ...final,
                            state: initial,
                            buyerBefore: initial.buyerPrice,
                            steps: results.map((r) => r.step),
                        },
                        result,
                    );
                }
            }
            if (claim && !(await this.journal.finish(offer, claim.token, undefined, notice, baseReceipt)))
                return pending('Другой исполнитель уже обработал этот шаг');
            return result;
        }
        const step = path.steps[0];
        const intent: Pending = {
            goal,
            requested: claim?.payload.requested ?? (isBase(request.goal) ? request.goal : undefined),
            initial: claim?.payload.initial ?? state,
            step,
            results,
            calculationKey: state.calculationKey,
            notify: claim?.payload.notify ?? (isBase(goal) || Boolean(options.notify)),
        };
        if (options.shouldStop?.()) return blocked('Задача остановлена');
        await options.assertCurrent?.();
        assertPricingWritesAllowed();
        const proof = step.change.kind === 'base' ? null : baseReceipt;
        const ticket = claim
            ? await this.journal.advance(offer, claim.token, intent, undefined, proof)
            : await this.journal.claim(offer, intent, undefined, version, proof);
        if (!ticket) return pending('Другой исполнитель уже отправляет изменение');
        try {
            const alternative = await this.send(step, state);
            if (step.change.kind === 'base') {
                await this.journal.advance(offer, ticket.token, { ...intent, baseAccepted: true });
            } else if (alternative) await this.journal.advance(offer, ticket.token, { ...intent, alternative });
        } catch (error) {
            if (error instanceof RejectedChange) {
                await this.journal.finish(offer, ticket.token);
                this.logger.warn(`[${offer}] Ozon отклонил изменение цены: ${error.message}`);
                return { status: 'blocked', results, reason: error.message, attempted: true };
            }
            // The connection can fail AFTER the write. Keep the outbox entry for a read-only reconciliation.
            return { ...pending(`Ответ Ozon не подтверждён: ${message(error)}`, results), attempted: true };
        } finally {
            priceUpdateQueue.changed('ozon', [offer, `#product:${state.productId}`]);
        }
        return undefined;
    }

    private async send(step: OzonTransitionStep, state: PromoPriceState): Promise<'kept' | 'removed' | void> {
        const change = step.change;
        const id = state.productId;
        if (change.kind === 'base') {
            const row = ozonResultsByOffer(await this.products.setPrice({ prices: [change.target] })).get(
                state.offerId,
            );
            if (row?.updated && !row.errors?.length) return;
            if (row?.updated) throw new Error('Ozon вернул предупреждение при импорте: базовая цена требует проверки');
            const reason =
                row?.errors?.map((e) => e.message || e.code).join(', ') || 'Ozon не вернул подтверждения импорта';
            if (row?.errors?.length && row.errors.every((e) => e.code && e.code !== 'api_error'))
                throw new RejectedChange(reason);
            throw new Error(reason);
        }
        if (change.kind === 'percent') {
            const response = await this.seller.setPercent(change.actionId, [{ sku: change.sku, percent: change.to }]);
            if (response.applied.some((p) => p.sku === change.sku)) return;
            if (response.rejected.length) throw new RejectedChange(response.rejected[0].reason);
            throw new Error('Нет подтверждения процента');
        }
        const slot = state.ozonActions.find((a) => a.actionId === change.actionId);
        if (!slot) throw new Error('Не найдено состояние акции Ozon');
        if (change.kind === 'ozon-remove' && slot.isVoucher) {
            if ((await this.actions.deactivate(change.actionId, [id])).includes(id)) return;
            throw new Error('Нет подтверждения исключения');
        }
        const result = await this.actions.update(change.actionId, [
            {
                productId: id,
                stock: change.kind === 'ozon-set' ? (change.stock ?? slot.stock) : slot.stock,
                actionPrice: change.kind === 'ozon-set' ? change.to : step.floor,
            },
        ]);
        if (change.kind === 'ozon-set' && result.removed.includes(id)) return 'removed';
        if (change.kind === 'ozon-remove' && result.added.includes(id)) return 'kept';
        if (result.added.includes(id) || result.unchanged.includes(id) || result.removed.includes(id)) return;
        const refusal = result.rejected.find((r) => r.productId === id);
        if (!refusal) throw new Error('Ответ акции Ozon не содержит результат товара');
        if (change.kind === 'ozon-remove') {
            if ((await this.actions.deactivate(change.actionId, [id])).includes(id)) return;
            throw new Error('Ozon ещё не подтвердил исключение товара');
        }
        throw new RejectedChange(refusal.reason);
    }
}

class RejectedChange extends Error {}
