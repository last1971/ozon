import { Injectable } from '@nestjs/common';
import { priceUpdateQueue } from '../../../helpers/price/price-update.queue';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoPriceApplier } from '../promo-price.applier';
import { PromoPriceService } from '../promo-price.service';
import { PromoPriceApplyResult, PromoPricePlan } from '../promo-price.types';
import { EnrichWithPricingCommand } from './enrich-with-pricing.command';
import { IPromoSweepContext } from './promo-sweep.context';
import { SweepGoal, sweepGoal } from './sweep-goal';

/** Применить планы по одному товару. Без apply — пропуск. Отмена задачи проверяется между товарами. */
@Injectable()
export class ApplySweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Изменение акций Ozon';
    readonly weight = 20;

    constructor(
        private readonly applier: PromoPriceApplier,
        private readonly priceService: PromoPriceService,
        private readonly enrich: EnrichWithPricingCommand,
    ) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        if (!context.apply) return context;
        const goal = sweepGoal(context.goal);
        const plans = (context.plans ?? []).filter((p) => p.steps.length);
        context.results = [];
        context.progress.total = plans.length;
        context.progress.done = 0;
        for (const plan of plans) {
            if (context.stopChain) break;
            let res = await this.applier.apply(plan, {
                snapshot: context.pricingSnapshots?.get(plan.offerId),
                priority: 'background',
                onWaiting: (waiting) => {
                    context.progress.counters.waiting = Number(waiting);
                },
                assertCurrent: async () => {
                    await context.assertInputsCurrent?.(plan.offerId);
                    if (context.stopChain) throw new Error('Задача остановлена');
                },
            });
            if (res.stale && !res.attempted) {
                res = await this.retryStale(res, goal, context);
            }
            context.results.push(res);
            context.progress.done++;
            const key = res.applied ? 'appliedOk' : 'appliedFailed';
            context.progress.counters[key] = (context.progress.counters[key] ?? 0) + 1;
        }
        return context;
    }

    private async retryStale(
        original: PromoPriceApplyResult,
        goal: SweepGoal,
        context: IPromoSweepContext,
    ): Promise<PromoPriceApplyResult> {
        const offerId = original.offerId;

        // Снимок до всех чтений — учитываем и артикул, и product_id (changed бампит оба)
        const snapshot = priceUpdateQueue.capture('ozon', [offerId, `#product:${original.productId}`]);

        // Свежее состояние товара (цены + акции)
        let freshStates: Awaited<ReturnType<typeof this.priceService.states>>;
        try {
            freshStates = await this.priceService.states([offerId]);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            return { ...original, notes: [...original.notes, `Повтор: не удалось прочитать состояние: ${reason}`] };
        }
        if (!freshStates.length) {
            return { ...original, notes: [...original.notes, 'Повтор: товар не найден в ответе Ozon'] };
        }

        const freshState = freshStates[0];

        // Пересчёт минимальной прибыльной цены
        const enrichResult = await this.enrich.enrichOne(freshState);
        if (enrichResult.status === 'no-stock') {
            return { ...original, notes: [...original.notes, 'Повтор: нет остатков — скидку не выставляем'] };
        }
        if (enrichResult.status === 'error') {
            return { ...original, notes: [...original.notes, `Повтор: не удалось рассчитать минимум: ${enrichResult.reason}`] };
        }

        // Если минимум Ozon выше расчётного — акция не может опуститься ниже minPrice,
        // пока repriceForService не обновит прайс-лист. Не пытаемся.
        if (freshState.calcMinPrice !== undefined && freshState.minPrice > freshState.calcMinPrice) {
            return {
                ...original,
                notes: [...original.notes, `Повтор: минимум Ozon (${freshState.minPrice} ₽) выше расчётного (${freshState.calcMinPrice} ₽) — ждём обновления цены`],
            };
        }

        // Если цель сверки больше не выбирает этот товар — скидка уже правильная.
        // Проверяем снимок и актуальность прихода перед тем как сообщить об успехе.
        if (!goal.selects(freshState)) {
            try {
                return await priceUpdateQueue.run(
                    'ozon',
                    async () => {
                        priceUpdateQueue.assertCurrent(snapshot);
                        await context.assertInputsCurrent?.(offerId);
                        return {
                            ...goal.plan(freshState),
                            results: [],
                            applied: true,
                            attempted: false,
                            stale: false,
                            notes: ['Повтор: скидка уже на месте после перечтения данных'],
                        } as PromoPriceApplyResult;
                    },
                    { priority: 'background' },
                );
            } catch (e) {
                const reason = e instanceof Error ? e.message : String(e);
                return { ...original, notes: [...original.notes, `Повтор: данные изменились за время проверки: ${reason}`] };
            }
        }

        // Новый план по свежим данным
        const freshPlan: PromoPricePlan = goal.plan(freshState);

        // Нельзя обеспечить минимальную прибыль — не отправляем
        if (!freshPlan.ok) {
            return {
                ...freshPlan,
                results: [],
                applied: false,
                attempted: false,
                stale: false,
                notes: [...freshPlan.notes, 'Повтор: план не обеспечивает минимальную прибыль — скидку не выставляем'],
            };
        }

        // Шагов нет, но цель товар выбирает: closest или нечего делать — не трогаем
        if (!freshPlan.steps.length) {
            return { ...freshPlan, results: [], applied: false, attempted: false, stale: false };
        }

        // Одна попытка с новым снимком
        const retryRes = await this.applier.apply(freshPlan, {
            snapshot,
            priority: 'background',
            onWaiting: (waiting) => {
                context.progress.counters.waiting = Number(waiting);
            },
            assertCurrent: async () => {
                await context.assertInputsCurrent?.(offerId);
                if (context.stopChain) throw new Error('Задача остановлена');
            },
        });
        return {
            ...retryRes,
            notes: ['Повтор после устаревшего плана', ...retryRes.notes],
        };
    }
}
