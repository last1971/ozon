export class ProductPriceDto {
    commissions: {
        fbs_direct_flow_trans_max_amount: number;
        fbs_direct_flow_trans_min_amount: number;
        sales_percent_fbs: number;
        sales_percent_fbo: number;
    };
    offer_id: string;
    price: {
        auto_action_enabled: boolean;
        auto_add_to_ozon_actions_list_enabled: boolean;

        currency_code: 'RUB' | 'BYN' | 'KZT' | 'EUR' | 'USD' | 'CNY';

        marketing_price: number;
        marketing_seller_price: number;
        min_price: number;
        net_price: number;
        old_price: number;
        price: number;
        retail_price: number;

        vat: number;
    };
    volume_weight: number;
    product_id: number;
}
