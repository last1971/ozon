import { lossOfferKey } from '../../helpers/price/marketplace.loss.stats';

/** Один товар статистики может иметь два артикула кабинета: код и код-1. */
export function groupLossPriceOffers(catalog: string[]): Map<string, string[]> {
    const offers = new Map<string, string[]>();
    for (const offer of new Set(catalog)) {
        try {
            const key = lossOfferKey(offer);
            offers.set(key, [...(offers.get(key) ?? []), offer]);
        } catch {
            // Артикулы другого формата не привязываются к числовой статистике.
        }
    }
    return offers;
}
