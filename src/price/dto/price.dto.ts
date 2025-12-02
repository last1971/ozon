import { ApiProperty } from '@nestjs/swagger';

export class PriceDto {
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
    incoming_price: number;
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
    sum_pack:number;
    @ApiProperty({ description: 'Остаток FBS', type: Number, example: 100 })
    fbsCount: number;
    @ApiProperty({ description: 'Остаток FBO', type: Number, example: 100 })
    fboCount: number;
    @ApiProperty({ description: 'Тип товара Ozon', type: Number, required: false })
    typeId?: number;
    @ApiProperty({ description: 'Объёмный вес в литрах', type: Number, required: false })
    volumeWeight?: number;
}
