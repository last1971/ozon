import { GoodPriceDto, PriceBaseSource } from '../../good/dto/good.price.dto';
import { GoodPercentDto } from '../../good/dto/good.percent.dto';
import { PriceSkipReason } from '../../price/price-update.report';

export interface ResolvedPriceBase {
    incoming_price: number | null;
    available_price: number;
    base_source: PriceBaseSource;
    skipReason?: PriceSkipReason;
}
const positive = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/** Рыночная цена уже за эту фасовку. Закупка — за штуку, умножается только она. */
export function resolvePriceBase(
    offerId: string,
    pieces: number,
    good: GoodPriceDto | undefined,
    percent?: GoodPercentDto,
    incomingOverride?: number,
    marketplaceStock = 0,
): ResolvedPriceBase {
    const none: ResolvedPriceBase = { incoming_price: null, available_price: 0, base_source: 'none' };
    if (!good) return { ...none, skipReason: 'not-in-stock' };
    const hasMarketplaceStock = Number.isFinite(marketplaceStock) && marketplaceStock > 0;
    if (!hasMarketplaceStock && good.free_stock != null && !(good.free_stock > 0)) return { ...none, skipReason: 'no-free-stock' };
    const code = offerId.replace(/-.*/g, '');
    const ownPercent = percent && String(percent.offer_id) === code && Number(percent.pieces ?? 1) === pieces;
    const market = ownPercent ? positive(percent.available_price) : null;
    if (market !== null) return { incoming_price: market, available_price: market, base_source: 'market' };
    const unitCost = good.base_source === 'none' ? null : positive(good.price) ?? (hasMarketplaceStock ? positive(good.purchase_price) : null);
    if (unitCost === null || !positive(pieces)) return { ...none, skipReason: 'no-base' };
    const cost = positive(incomingOverride) ?? unitCost * pieces;
    return {
        incoming_price: cost,
        available_price: 0,
        base_source: good.base_source === 'all-receipts' ? 'all-receipts' : 'remaining-lots',
    };
}
