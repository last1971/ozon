import { goodCode, goodQuantityCoeff } from '../product/product.helpers';
import type { OzonSaleLine } from './ozon.accrual.normalizer';

export interface OzonInvoiceQuantityLine {
    goodscode: string;
    quantity: number;
    pieces: number | null;
}

/**
 * Количество ПРОДАЖИ из строк существующего счёта. QUAN — штуки, результат — пачки артикула.
 * Счёт не определяет количество частичного возврата и не делится на несколько начислений наугад.
 */
export function resolveOzonInvoiceQuantity(
    target: OzonSaleLine,
    sales: readonly OzonSaleLine[],
    skuToOffer: ReadonlyMap<string, string>,
    invoiceLines: readonly OzonInvoiceQuantityLine[],
): number | null {
    if (target.kind !== 'sale' || target.units !== null) return target.units;
    const offer = skuToOffer.get(target.sku);
    if (!offer || !/^\d+(?:-[1-9]\d*)?$/.test(offer)) return null;
    const code = goodCode({ offer_id: offer });
    const pieces = goodQuantityCoeff({ offer_id: offer });
    if (!Number.isSafeInteger(pieces) || pieces <= 0) return null;
    const peers = sales.filter((line) => line.posting === target.posting && line.kind === 'sale' && line !== target);
    let otherPack = false;
    for (const peer of peers) {
        const peerOffer = skuToOffer.get(peer.sku);
        if (!peerOffer || !/^\d+(?:-[1-9]\d*)?$/.test(peerOffer)) return null;
        if (goodCode({ offer_id: peerOffer }) !== code) continue;
        if (goodQuantityCoeff({ offer_id: peerOffer }) === pieces) return null;
        otherPack = true;
    }
    const sameGood = invoiceLines.filter((line) => String(line.goodscode) === code);
    if (otherPack && sameGood.some((line) => line.pieces == null)) return null;
    const matching = sameGood.filter((line) => line.pieces == null || line.pieces === pieces);
    if (!matching.length || matching.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity <= 0))
        return null;
    const quantity = matching.reduce((total, line) => total + line.quantity, 0);
    if (!Number.isSafeInteger(quantity)) return null;
    const units = quantity / pieces;
    return Number.isSafeInteger(units) && units > 0 ? units : null;
}
