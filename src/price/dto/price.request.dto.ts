import { ProductFilterDto } from '../../product/dto/product.filter.dto';
import { ApiProperty } from '@nestjs/swagger';

class SubFilter {
    @ApiProperty({ type: ProductFilterDto })
    filter: ProductFilterDto;
}
export class PriceRequestDto {
    @ApiProperty({ description: 'Фильтр по товарам', required: true, type: () => SubFilter })
    filter: ProductFilterDto;
    @ApiProperty({ description: 'Идентификатор последнего значения на странице.', required: false })
    last_id?: string;
    @ApiProperty({ description: 'Количество значений на странице. Минимум — 1, максимум — 1000', required: true })
    limit: number;
}
