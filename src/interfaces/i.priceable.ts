import { PriceBaseSource } from '../good/dto/good.price.dto';

export interface IPriceable {
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
