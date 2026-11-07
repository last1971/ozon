import type { MarketplaceLossCostsInput } from '../helpers/price/marketplace.loss.costs';
import type { OzonPricingContext } from '../helpers/price/ozon.pricing';
import { PriceBaseSource } from '../good/dto/good.price.dto';

export interface IPriceable {
    ozon?: OzonPricingContext;
    lossCosts?: MarketplaceLossCostsInput;
    offer_id: string;
    base_source?: PriceBaseSource;
    incoming_price: number;
    available_price: number;
    fbs_direct_flow_trans_max_amount: number;
    sales_percent: number;
    min_perc: number;
    perc: number;
    old_perc: number;
    adv_perc: number;
    sum_pack: number;
    /** Доля 0..1, только для Ozon. */
    return_perc?: number;
    return_flow_amount?: number;
}
