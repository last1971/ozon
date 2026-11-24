import { PromoPriceService } from '../promo-price.service';
import { PromoPriceApplyResult, PromoPriceState, PromoPriceStep } from '../promo-price.types';

function matchesStep(step: PromoPriceStep, actual: PromoPriceState): boolean {
    if (step.kind === 'percent') {
        const seller = actual.seller;
        return seller?.isActive && seller.actionId === step.actionId && seller.sku === step.sku && seller.percent === step.to;
    }
    const slot = actual.ozonActions.find(action => action.actionId === step.actionId);
    return step.kind === 'ozon-remove' ? !slot?.participant : slot?.participant && slot.actionPrice === step.to;
}

/** Пакетное чтение Ozon после записи. При задержке Ozon задача сохраняет ответ API и фактическое состояние. */
export async function verifySweepChanges(results: PromoPriceApplyResult[], prices: Pick<PromoPriceService, 'allStates'>) {
    const sent = results.filter(result => !result.verification && result.applied && result.results.length > 0);
    if (!sent.length) return;
    let states: Map<string, PromoPriceState>;
    try {
        states = new Map((await prices.allStates(sent.map(r => r.offerId))).map(s => [s.offerId, s]));
    } catch (error) {
        for (const result of sent) {
            result.verification = 'pending';
            result.notes.push(`Ozon принял изменения. Не удалось подтвердить цену и акции: ${error.message}`);
        }
        return;
    }
    for (const result of sent) {
        const state = states.get(result.offerId);
        if (state?.productId === result.productId && state.buyerPrice > 0) result.observedBuyerPrice = state.buyerPrice;
        if (result.observedBuyerPrice !== result.buyerAfter || !state || !result.steps.every(step => matchesStep(step, state))) {
            result.verification = 'pending';
            result.notes.push('Ozon принял запрос, но ещё не подтвердил итоговую цену и участие в акциях');
            continue;
        }
        for (const row of result.results) {
            row.changed = row.status === 'ok' && row.changed !== false && !matchesStep(row.step, result.state);
        }
        result.verification = result.results.some(row => row.changed) ? 'confirmed' : 'unchanged';
    }
}
