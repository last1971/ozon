import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoPriceStep, PromoSweepItem } from '../promo-price.types';
import { IPromoSweepContext } from './promo-sweep.context';

/** Планы (и итоги применения) → отчёт со счётчиками. Строки без полного состояния товара. */
@Injectable()
export class BuildSweepReportCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Подготовка отчёта';
    readonly weight = 1;
    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const results = new Map((context.results ?? []).map((r) => [r.offerId, r]));
        const has = (item: PromoSweepItem, kind: PromoPriceStep['kind']) =>
            context.apply
                ? item.verification === 'confirmed' &&
                  item.results.some((r) => r.step.kind === kind && r.status === 'ok')
                : item.steps.some((s) => s.kind === kind);
        const items: PromoSweepItem[] = (context.plans ?? []).map((p) => {
            const r = results.get(p.offerId);
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
                notes: r?.notes ?? p.notes,
                ...(r
                    ? {
                          results: r.results,
                          applied: r.applied,
                          verification: r.verification,
                          observedBuyerPrice: r.observedBuyerPrice,
                      }
                    : {}),
            };
        });
        context.report = {
            apply: context.apply,
            goal: context.goal,
            checked: context.checked ?? 0,
            selected: items.length,
            priceChanged: items.filter((i) => has(i, 'base')).length,
            percentChanged: items.filter((i) => has(i, 'percent')).length,
            unfixable: items.filter((i) => !i.ok).length,
            pendingConfirmation: items.filter((i) => i.verification === 'pending').length,
            failed: (context.results ?? []).filter((r) => !r.applied).length,
            // сначала то, что не лечится и не прошло, потом по дальности от минимальной
            items: items.sort(
                (a, b) =>
                    Number(a.ok) - Number(b.ok) ||
                    Number(a.applied ?? true) - Number(b.applied ?? true) ||
                    Math.abs(b.buyerBefore / (b.target || 1) - 1) - Math.abs(a.buyerBefore / (a.target || 1) - 1),
            ),
        };
        Object.assign(context.progress.counters, {
            priceChanged: context.report.priceChanged,
            percentChanged: context.report.percentChanged,
            unfixable: context.report.unfixable,
        });
        return context;
    }
}
