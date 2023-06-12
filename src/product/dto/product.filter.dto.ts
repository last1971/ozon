import { ApiProperty } from '@nestjs/swagger';
import { ProductVisibility } from '../product.visibility';

export class ProductFilterDto {
    @ApiProperty({ description: 'Фильтр по параметру offer_id.', required: false, isArray: true, type: 'string' })
    offer_id?: string[];
    @ApiProperty({ description: 'Фильтр по параметру product_id.', required: false, isArray: true, type: 'number' })
    product_id?: number[];
    @ApiProperty({ description: 'Фильтр по видимости товара', required: false, enum: ProductVisibility })
    visibility = ProductVisibility.ALL;
}
