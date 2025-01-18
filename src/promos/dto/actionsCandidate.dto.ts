import { ApiProperty } from '@nestjs/swagger';

export class ActionsListDto {
    @ApiProperty({ description: 'Список товаров', type: () => [ActionListProduct] })
    products: ActionListProduct[];

    @ApiProperty({ description: 'Общее количество товаров, которое доступно для акции' })
    total: number;
}

export class ActionListProduct {
    @ApiProperty({ description: 'Идентификатор товара' })
    id: number;

    @ApiProperty({ description: 'Текущая цена товара без скидки' })
    price: number;

    @ApiProperty({ description: 'Цена товара по акции' })
    action_price: number;

    @ApiProperty({ description: 'Максимально возможная цена товара по акции' })
    max_action_price: number;

    @ApiProperty({ description: 'Тип добавления товара в акцию: автоматически или вручную продавцом' })
    add_mode: string;

    @ApiProperty({ description: 'Минимальное число единиц товара в акции типа «Скидка на сток»' })
    min_stock: number;

    @ApiProperty({ description: 'Число единиц товара в акции типа «Скидка на сток»' })
    stock: number;
}
