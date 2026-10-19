import { MarketingActionDto } from '../../helpers/price/buyer.price.helper';

export class ProductPriceDto {
    commissions: {
        fbs_direct_flow_trans_max_amount: number;
        fbs_direct_flow_trans_min_amount: number;
        fbo_direct_flow_trans_max_amount: number;
        fbo_direct_flow_trans_min_amount: number;
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
    /** Акции, в которых товар участвует сейчас (v5): у Ozon-акций value — цена, у нашей seller-акции — процент. */
    marketing_actions?: {
        current_period_from: string;
        current_period_to: string;
        actions: MarketingActionDto[];
        ozon_actions_exist: boolean;
    };
}
