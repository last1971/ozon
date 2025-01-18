import { ApiProperty } from '@nestjs/swagger';

export class ActionsDto {
    @ApiProperty({ description: 'Идентификатор акции' })
    id: number;

    @ApiProperty({ description: 'Название акции' })
    title: string;

    @ApiProperty({ description: 'Тип акции' })
    action_type: string;

    @ApiProperty({ description: 'Описание акции' })
    description: string;

    @ApiProperty({ description: 'Дата начала акции' })
    date_start: string;

    @ApiProperty({ description: 'Дата окончания акции' })
    date_end: string;

    @ApiProperty({ description: 'Дата приостановки акции' })
    freeze_date: string;

    @ApiProperty({ description: 'Количество товаров, доступных для акции' })
    potential_products_count: number;

    @ApiProperty({ description: 'Количество товаров, которые участвуют в акции' })
    participating_products_count: number;

    @ApiProperty({ description: 'Участвуете вы в этой акции или нет' })
    is_participating: boolean;

    @ApiProperty({ description: 'Признак, что для участия в акции покупателям нужен промокод' })
    is_voucher_action: boolean;

    @ApiProperty({ description: 'Количество заблокированных товаров' })
    banned_products_count: number;

    @ApiProperty({ description: 'Признак, что акция с целевой аудиторией' })
    with_targeting: boolean;

    @ApiProperty({ description: 'Сумма заказа' })
    order_amount: number;

    @ApiProperty({ description: 'Тип скидки' })
    discount_type: string;

    @ApiProperty({ description: 'Размер скидки' })
    discount_value: number;
}
