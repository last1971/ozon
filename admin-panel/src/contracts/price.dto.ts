export interface PriceDto {
    product_id: number;
    offer_id: string;
    name: string;
    marketing_price: number;
    marketing_seller_price: number;
    available_price: number;
    incoming_price: number;
    min_price: number;
    price: number;
    old_price: number;
    min_perc: number;
    perc: number;
    old_perc: number;
    adv_perc: number;
    sales_percent: number;
    fbs_direct_flow_trans_max_amount: number;
    auto_action_enabled: boolean;
    sum_pack:number;
    fbsCount: number;
    fboCount: number;
}
