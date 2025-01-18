import { ApiProperty } from '@nestjs/swagger';

export class ActivateOrDeactivateActionProductsDto {
    @ApiProperty({ description: 'Список идентификаторов товаров, которые добавлены/удалены в/из акцию.' })
    product_ids: number[];

    @ApiProperty({
        description: 'Список товаров, которые не удалось добавить/удалить в/из акцию.',
        type: () => [RejectedProduct],
    })
    rejected: RejectedProduct[];
}

export class RejectedProduct {
    @ApiProperty({ description: 'Идентификатор товара' })
    product_id: number;

    @ApiProperty({ description: 'Причина, почему товар не добавлен/удалён в/из акцию.' })
    reason: number;
}
