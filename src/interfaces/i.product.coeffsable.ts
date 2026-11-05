import type { OzonPricingContext } from '../helpers/price/ozon.pricing';
export interface IProductCoeffsable {
    getOzonPricing?(): OzonPricingContext;
    getSku(): string;
    getSalesPercent(): number;
    getTransMaxAmount(): number;
    /** Только площадки с учётом возвратов; отсутствие тарифа не означает бесплатный возврат. */
    getReturnFlowAmount?(): number | undefined;
}
