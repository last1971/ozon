import { ozonSkuOf, ozonUnitsOf } from './ozon.accrual.normalizer';
import type { MpEventRowDto } from '../../mp-event/mp-event.service';

export const ozonPostingSkuKey = (posting: string, sku: string): string => JSON.stringify([posting, sku]);

/** Один раз интерпретируем состояния возврата для процентов и расходов. */
export function ozonReturnEvidence(events: MpEventRowDto[], skuToOffer: ReadonlyMap<string, string>) {
    const offers = new Map(skuToOffer);
    const clients = new Map<string, number>();
    const cancellations = new Set<string>();
    const seenReturns = new Set<string>();
    const latest = [...events].sort((a, b) => b.firstSeen.getTime() - a.firstSeen.getTime());
    for (const event of latest) {
        if (seenReturns.has(event.extId)) continue;
        seenReturns.add(event.extId);
        const p = event.payload as {
            id?: number | string;
            type?: string;
            posting_number?: string;
            product?: { sku?: number; offer_id?: string; quantity?: number };
        };
        if (!p || String(p.id) !== event.extId || p.posting_number !== event.posting) {
            throw new Error(`Некорректная запись возврата Ozon ${event.extId}`);
        }
        if (p.type !== 'ClientReturn' && p.type !== 'Cancellation') continue;
        const sku = ozonSkuOf(p.product?.sku);
        const offerId = p.product?.offer_id?.trim();
        if (!offerId) throw new Error(`Нет артикула в возврате Ozon ${event.extId}`);
        if (offers.has(sku) && offers.get(sku) !== offerId) {
            throw new Error(`Неоднозначное соответствие SKU Ozon ${sku} артикулу`);
        }
        offers.set(sku, offerId);
        const key = ozonPostingSkuKey(event.posting, sku);
        if (p.type === 'Cancellation') cancellations.add(key);
        else clients.set(key, (clients.get(key) ?? 0) + ozonUnitsOf(p.product?.quantity));
    }

    return { offers, clients, cancellations };
}
