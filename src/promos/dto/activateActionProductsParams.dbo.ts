import { ApiProperty } from '@nestjs/swagger';

export class ActivateActionProductsParamsDto {
    @ApiProperty({ description: 'Идентификатор акции' })
    action_id: number;

    @ApiProperty({ description: 'Список товаров', type: () => [ActivateActionProduct] })
    products: ActivateActionProduct[];
}

export class ActivateActionProduct {
    @ApiProperty({ description: 'Идентификатор товара' })
    product_id: number;

    @ApiProperty({ description: 'Цена товара по акции' })
    action_price: number;

    @ApiProperty({ description: 'Количество единиц товара в акции типа «Скидка на сток».' })
    stock: number;
}
