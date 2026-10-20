import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoPricePlan, PromoSweepItem } from '../promo-price.types';
import { IPromoSweepContext } from './promo-sweep.context';

/** Планы (и итоги применения) → отчёт со счётчиками. Строки без полного состояния товара. */
@Injectable()
export class BuildSweepReportCommand implements IJobCommand<IPromoSweepContext> {
    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const plans = context.plans ?? [];
        const results = new Map((context.results ?? []).map((r) => [r.productId, r]));
        const has = (p: PromoPricePlan, kind: string) => p.steps.some((s) => s.kind === kind);

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
                steps: p.steps,
                notes: p.notes,
                ...(r ? { results: r.results, applied: r.applied } : {}),
            };
        });
        context.report = {
            apply: context.apply,
            goal: context.goal,
            checked: context.checked ?? 0,
            selected: plans.length,
            keptInOzon: plans.filter((p) => has(p, 'ozon-set') && !has(p, 'ozon-remove')).length,
            removedFromOzon: plans.filter((p) => has(p, 'ozon-remove')).length,
            percentChanged: plans.filter((p) => has(p, 'percent')).length,
            unfixable: plans.filter((p) => !p.ok).length,
            nothingToDo: plans.filter((p) => !p.steps.length).length,
            failed: (context.results ?? []).filter((r) => !r.applied).length,
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
