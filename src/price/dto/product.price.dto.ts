export class ProductPriceDto {
    commissions: {
        fbs_direct_flow_trans_max_amount: number;
        fbs_direct_flow_trans_min_amount: number;
        sales_percent_fbs: number;
        sales_percent_fbo: number;
    };
    offer_id: string;
    price: {
        marketing_price: number;
        marketing_seller_price: number;
        min_price: number;
        price: number;
        old_price: number;
        auto_action_enabled: boolean;
    };
    volume_weight: number;
    product_id: number;
}
