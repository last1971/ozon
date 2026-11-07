import type { LossPricingStatistics } from '../marketplace-loss/loss-pricing.service';
import type { OzonPricingContext } from '../helpers/price/ozon.pricing';
export interface IProductCoeffsable {
    getLossStatistics?(): LossPricingStatistics | undefined;
    getOzonPricing?(): OzonPricingContext;
    getSku(): string;
    getSalesPercent(): number;
    getTransMaxAmount(): number;
    /** Только площадки с учётом возвратов; отсутствие тарифа не означает бесплатный возврат. */
    getReturnFlowAmount?(): number | undefined;
}
