import type { PromoPriceService } from '../promo-price.service';
import { PromoPriceApplyResult, PromoPriceState, PromoPriceStep } from '../promo-price.types';

function matchesStep(step: PromoPriceStep, actual: PromoPriceState): boolean {
    if (step.kind === 'percent')
        return actual.seller?.isActive && actual.seller.sku === step.sku && actual.seller.percent === step.to;
    const t = step.target;
    return (
        actual.price === Number(t.price) &&
        actual.minPrice === Number(t.min_price) &&
        actual.oldPrice === Number(t.old_price)
    );
}

/** Пакетное чтение Ozon после записи: что Ozon уже показывает, а что ещё нет. */
export async function verifySweepChanges(
    results: PromoPriceApplyResult[],
    prices: Pick<PromoPriceService, 'pricedStates'>,
) {
    const sent = results.filter((r) => r.applied && r.results.length > 0);
    if (!sent.length) return;
    let states: Map<string, PromoPriceState>;
    try {
        states = new Map((await prices.pricedStates(sent.map((r) => r.offerId))).map((s) => [s.offerId, s]));
    } catch (error) {
        for (const r of sent) {
            r.verification = 'pending';
            r.notes.push(`Ozon принял изменения. Не удалось перечитать цену: ${error.message}`);
        }
        return;
    }
    for (const r of sent) {
        const state = states.get(r.offerId);
        if (state?.buyerPrice > 0) r.observedBuyerPrice = state.buyerPrice;
        r.verification = state && r.steps.every((step) => matchesStep(step, state)) ? 'confirmed' : 'pending';
        if (r.verification === 'pending') r.notes.push('Ozon принял запрос, но ещё не показывает новую цену');
    }
}
