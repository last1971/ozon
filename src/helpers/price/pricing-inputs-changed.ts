import type { EventEmitter2 } from '@nestjs/event-emitter';
import { lossOfferKey } from './marketplace.loss.stats';

export const PRICING_INPUTS_CHANGED = 'pricing.inputs.changed';
export interface PricingInputsChanged {
    service?: 'OZON' | 'WB';
    offers?: string[];
    codes?: string[];
}
export function matchesPricingInputs(offer: string, change?: PricingInputsChanged): boolean {
    if (!change) return false;
    if (!change.offers && !change.codes) return true;
    try {
        const key = lossOfferKey(offer);
        return (
            !!change.offers?.some((id) => {
                try {
                    return lossOfferKey(id) === key;
                } catch {
                    return false;
                }
            }) || !!change.codes?.includes(key.split('-')[0])
        );
    } catch {
        return false;
    }
}
export function mergePricingInputs(a: PricingInputsChanged | undefined, b: PricingInputsChanged): PricingInputsChanged {
    if ((a && !a.offers && !a.codes) || (!b.offers && !b.codes)) return {};
    return {
        offers: [...new Set([...(a?.offers ?? []), ...(b.offers ?? [])])],
        codes: [...new Set([...(a?.codes ?? []), ...(b.codes ?? [])])],
    };
}
/** Вызывается только после собственного commit. Не выдаёт ошибку уведомления за откат данных. */
export function notifyPricingInputs(
    events: EventEmitter2 | undefined,
    change: PricingInputsChanged,
    onError: (error: unknown) => void,
): void {
    try {
        events?.emit(PRICING_INPUTS_CHANGED, change);
    } catch (error) {
        onError(error);
    }
}
