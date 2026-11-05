import { OzonSaleLine, ozonSkuOf, ozonUnitsOf } from './ozon.accrual.normalizer';
import type { MpEventRowDto } from '../../mp-event/mp-event.service';
import { calculateOzonReturnPerc } from './ozon.return.perc';

export interface OzonReturnStat {
    offerId: string;
    soldUnits: number;
    paidReturnUnits: number;
    /** null — есть неоднозначные сторно; нулевой процент вместо них не подставляем. */
    returnPerc: number | null;
}
export interface OzonReturnIssue {
    reason: 'unmapped-sku' | 'unmatched-refund' | 'ambiguous-refund' | 'unknown-quantity' | 'ambiguous-rebooking';
    posting: string;
    sku: string;
    units: number | null;
}
export interface OzonReturnReport {
    rows: OzonReturnStat[];
    issues: OzonReturnIssue[];
}

const pairKey = (posting: string, sku: string): string => JSON.stringify([posting, sku]);

/**
 * Считаем единицы артикула (пачки), а не число событий/начислений и не штуки внутри пачки.
 * Окно уже применено к начислениям. Состояния возврата читаются по отправлению без окна:
 * дата наблюдения логистического состояния не является датой денежного сторно.
 */
export function buildOzonReturnStats(
    lines: OzonSaleLine[],
    events: MpEventRowDto[],
    skuToOffer: ReadonlyMap<string, string>,
    ambiguousPostings: ReadonlySet<string> = new Set(),
): OzonReturnReport {
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
        const key = pairKey(event.posting, sku);
        if (p.type === 'Cancellation') cancellations.add(key);
        else clients.set(key, (clients.get(key) ?? 0) + ozonUnitsOf(p.product?.quantity));
    }

    const groups = new Map<
        string,
        { posting: string; sku: string; sold: number; refunded: number; unknownQuantity: boolean }
    >();
    for (const line of lines) {
        const key = pairKey(line.posting, line.sku);
        const group = groups.get(key) ?? {
            posting: line.posting,
            sku: line.sku,
            sold: 0,
            refunded: 0,
            unknownQuantity: false,
        };
        if (line.units === null) group.unknownQuantity = true;
        else if (line.kind === 'sale') group.sold += line.units;
        else group.refunded += line.units;
        groups.set(key, group);
    }
    const rows = new Map<string, OzonReturnStat>();
    const issues: OzonReturnIssue[] = [];
    const incomplete = new Set<string>();
    for (const [key, group] of groups) {
        const offerId = offers.get(group.sku);
        if (!offerId) {
            issues.push({
                reason: 'unmapped-sku',
                posting: group.posting,
                sku: group.sku,
                units: group.unknownQuantity ? null : group.sold + group.refunded,
            });
            continue;
        }
        const row = rows.get(offerId) ?? { offerId, soldUnits: 0, paidReturnUnits: 0, returnPerc: 0 };
        row.soldUnits += group.sold;
        rows.set(offerId, row);
        if (ambiguousPostings.has(group.posting)) {
            issues.push({ reason: 'ambiguous-rebooking', posting: group.posting, sku: group.sku, units: null });
            incomplete.add(offerId);
        }
        if (group.unknownQuantity) {
            issues.push({ reason: 'unknown-quantity', posting: group.posting, sku: group.sku, units: null });
            incomplete.add(offerId);
        }
        if (!group.refunded) continue;
        const clientUnits = clients.get(key) ?? 0;
        if (!clientUnits && cancellations.has(key)) continue;
        if (!clientUnits || cancellations.has(key) || group.refunded > clientUnits) {
            issues.push({
                reason: !clientUnits ? 'unmatched-refund' : 'ambiguous-refund',
                posting: group.posting,
                sku: group.sku,
                units: group.refunded,
            });
            incomplete.add(offerId);
            continue;
        }
        // При частичной оплате учитываем только количество из денежного сторно.
        row.paidReturnUnits += group.refunded;
    }
    for (const row of rows.values()) {
        row.returnPerc = incomplete.has(row.offerId) ? null : calculateOzonReturnPerc(row);
    }
    return { rows: [...rows.values()].sort((a, b) => a.offerId.localeCompare(b.offerId)), issues };
}
