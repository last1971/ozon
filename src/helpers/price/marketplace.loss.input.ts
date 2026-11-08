import { IProductCoeffsable } from '../../interfaces/i.product.coeffsable';
import { GoodPriceDto } from '../../good/dto/good.price.dto';
import { IPriceable } from '../../interfaces/i.priceable';
import { goodCode, goodQuantityCoeff } from '../product/product.helpers';
import type { LossPricingStatistics } from '../../marketplace-loss/loss-pricing.service';

/** Закупка упаковки для брака никогда не берётся из ручной рыночной базы. */
export function lossPriceFields(
    statistics: LossPricingStatistics | undefined,
    good: GoodPriceDto | undefined,
    pieces: number,
    marketplaceStock = 0,
): Pick<IPriceable, 'lossCosts'> {
    if (!statistics) return {};
    const unit = good?.base_source === 'none' ? NaN : good?.price ?? (marketplaceStock > 0 ? good?.purchase_price : null);
    const purchaseCost =
        typeof unit === 'number' && Number.isFinite(unit) && unit > 0 && Number.isSafeInteger(pieces) && pieces > 0
            ? unit * pieces
            : null;
    return { lossCosts: { ...statistics, purchaseCost } };
}
export function productLossPriceFields(product: IProductCoeffsable, goods: GoodPriceDto[]) {
    const offer_id = product.getSku();
    return lossPriceFields(
        product.getLossStatistics?.() ?? product.getOzonPricing?.()?.lossStatistics,
        goods.find((good) => String(good.code) === goodCode({ offer_id })),
        goodQuantityCoeff({ offer_id }),
        product.getMarketplaceStock?.() ?? 0,
    );
}
