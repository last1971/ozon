import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoSweepItem, PromoPriceStep } from '../promo-price.types';
import { IPromoSweepContext } from './promo-sweep.context';

/** Планы (и итоги применения) → отчёт со счётчиками. Строки без полного состояния товара. */
@Injectable()
export class BuildSweepReportCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Подготовка отчёта';
    readonly weight = 1;
    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const results = new Map((context.results ?? []).map((r) => [r.productId, r]));
        // Перед отправкой план мог измениться вслед за лимитами Ozon.
        const plans = (context.plans ?? []).map((p) => results.get(p.productId) ?? p);
        const has = (item: PromoSweepItem, kind: PromoPriceStep['kind']) => context.apply
            ? item.verification === 'confirmed' && item.results.some(r => r.step.kind === kind && r.status === 'ok' && r.changed !== false)
            : item.steps.some(s => s.kind === kind);

        const items: PromoSweepItem[] = plans.map((p) => {
            const r = results.get(p.productId);
            return {
                offerId: p.offerId,
                productId: p.productId,
                price: p.state.price,
                minPrice: p.state.minPrice,
                target: p.target,
                buyerBefore: p.buyerBefore,
                buyerAfter: p.buyerAfter,
                ok: p.ok,
                closest: p.closest,
                steps: p.steps,
                notes: p.notes,
                ...(r ? { results: r.results, applied: r.applied, verification: r.verification, observedBuyerPrice: r.observedBuyerPrice } : {}),
            };
        });
        context.report = {
            apply: context.apply,
            goal: context.goal,
            checked: context.checked ?? 0,
            selected: plans.length,
            keptInOzon: items.filter((p) => has(p, 'ozon-set') && !has(p, 'ozon-remove')).length,
            removedFromOzon: items.filter((p) => has(p, 'ozon-remove')).length,
            percentChanged: items.filter((p) => has(p, 'percent')).length,
            unfixable: plans.filter((p) => !p.ok).length,
            closest: plans.filter((p) => p.closest).length,
            nothingToDo: plans.filter((p) => !p.steps.length && !p.closest).length,
            pendingConfirmation: items.filter(i => i.verification === 'pending').length,
            failed: (context.results ?? []).filter((r) => !r.applied && r.verification !== 'pending').length,
            // сначала то, что не лечится и не прошло, потом по дальности от цели
            items: items.sort(
                (a, b) =>
                    Number(a.ok) - Number(b.ok) ||
                    Number(a.applied ?? true) - Number(b.applied ?? true) ||
                    Math.abs(b.buyerBefore / b.target - 1) - Math.abs(a.buyerBefore / a.target - 1),
            ),
        };
        Object.assign(context.progress.counters, {
            keptInOzon: context.report.keptInOzon,
            removedFromOzon: context.report.removedFromOzon,
            unfixable: context.report.unfixable,
        });
        return context;
    }
}
