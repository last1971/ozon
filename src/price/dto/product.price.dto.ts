export class ProductPriceDto {
    commissions: {
        fbs_direct_flow_trans_max_amount: number;
        fbs_direct_flow_trans_min_amount: number;
        sales_percent: number;
    };
    offer_id: string;
    price: {
        marketing_price: number;
        marketing_seller_price: number;
        min_price: number;
        price: number;
        old_price: number;
    };
    volume_weight: number;
    product_id: number;
}
