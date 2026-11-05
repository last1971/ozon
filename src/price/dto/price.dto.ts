import type { OzonPricingContext } from '../../helpers/price/ozon.pricing';
import { PriceBaseSource } from '../../good/dto/good.price.dto';
import { ApiProperty } from '@nestjs/swagger';
import { MarketingActionDto } from '../../helpers/price/buyer.price.helper';

export class PriceDto {
    ozon?: OzonPricingContext;
    @ApiProperty({ description: 'Код товара Озон' })
    product_id: number;
    @ApiProperty({ description: 'Наш код товара' })
    offer_id: string;
    @ApiProperty({ description: 'Название товара у нас' })
    name: string;
    @ApiProperty({ description: 'Цена озон покупателю' })
    marketing_price: number;
    @ApiProperty({ description: 'Цена расчета Озон' })
    marketing_seller_price: number;
    @ApiProperty({ description: 'Входящая цена' })
    incoming_price: number | null;
    @ApiProperty({ description: 'Источник базы: market / remaining-lots / all-receipts / none', required: false })
    base_source?: PriceBaseSource;
    @ApiProperty({ description: 'Рыночная цена' })
    available_price: number;
    @ApiProperty({ description: 'Мин цена' })
    min_price: number;
    @ApiProperty({ description: 'Цена' })
    price: number;
    @ApiProperty({ description: 'Макс цена' })
    old_price: number;
    @ApiProperty({ description: 'Мин наценка' })
    min_perc: number;
    @ApiProperty({ description: 'Наценка' })
    perc: number;
    @ApiProperty({ description: 'Макс наценка' })
    old_perc: number;
    @ApiProperty({ description: 'Процент на рекламу' })
    adv_perc: number;
    @ApiProperty({ description: 'Процент комиссии Озон' })
    sales_percent: number;
    @ApiProperty({ description: 'Расходы на доставку покупателю' })
    fbs_direct_flow_trans_max_amount: number;
    @ApiProperty({ description: 'автоприменение акций у товара' })
    auto_action_enabled: boolean;
    @ApiProperty({ description: 'Стоимость упаковки' })
    sum_pack: number;
    return_perc?: number;
    return_flow_amount?: number;
    /** Исходные тарифы нужны при выборе другой схемы в оптимизации комиссии. */
    fbs_return_flow_amount?: number;
    fbo_return_flow_amount?: number;
    @ApiProperty({ description: 'Остаток FBS', type: Number, example: 100 })
    fbsCount: number;
    @ApiProperty({ description: 'Остаток FBO', type: Number, example: 100 })
    fboCount: number;
    @ApiProperty({ description: 'Тип товара Ozon', type: Number, required: false })
    typeId?: number;
    @ApiProperty({ description: 'Объёмный вес в литрах', type: Number, required: false })
    volumeWeight?: number;
    @ApiProperty({
        description: 'Акции товара сейчас (v5 marketing_actions): у Ozon-акций value — цена, у нашей — процент',
        required: false,
    })
    marketing_actions?: MarketingActionDto[];
}
