import { IOfferIdable } from '../../interfaces/IOfferIdable';
import { ApiProperty } from "@nestjs/swagger";

export class ProductPostingDto implements IOfferIdable {
    @ApiProperty({ description: 'Цена продукта', example: '1000' })
    price: string;

    @ApiProperty({ description: 'SKU', example: 'offer123' })
    offer_id: string;

    @ApiProperty({ description: 'Количество продукта', example: 2 })
    quantity: number;
}
