import { ApiProperty } from '@nestjs/swagger';
import { ProductVisibility } from '../../product/product.visibility';

export class PriceRequestDto {
    @ApiProperty({ description: 'Фильтр по параметру offer_id.', required: false, isArray: true, type: 'string' })
    offer_id?: string[];
    @ApiProperty({ description: 'Фильтр по параметру product_id.', required: false, isArray: true, type: 'number' })
    product_id?: number[];
    @ApiProperty({ description: 'Фильтр по видимости товара', required: false, enum: ProductVisibility })
    visibility = ProductVisibility.ALL;
    @ApiProperty({ description: 'Идентификатор последнего значения на странице.', required: false })
    last_id?: string;
    @ApiProperty({ description: 'Количество значений на странице. Минимум — 1, максимум — 1000', required: true })
    limit: number;
}
