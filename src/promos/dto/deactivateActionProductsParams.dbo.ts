import { ApiProperty } from '@nestjs/swagger';

export class DeactivateActionProductsParamsDto {
    @ApiProperty({ description: 'Идентификатор акции' })
    action_id: number;

    @ApiProperty({ description: 'Список идентификаторов товаров.', type: () => [Number] })
    product_ids: number[];
}
