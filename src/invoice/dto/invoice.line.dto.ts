import { ApiProperty } from '@nestjs/swagger';

export class InvoiceLineDto {
    @ApiProperty({
        description: 'Код товара',
        example: 'ABC123',
    })
    goodCode: string;

    @ApiProperty({
        description: 'Количество товара',
        example: 10,
    })
    quantity: number;

    @ApiProperty({
        description: 'Цена товара',
        example: '1500.50',
    })
    price: string;

    @ApiProperty({
        description: 'Оригинальный код товара (опционально)',
        example: 'XYZ789',
        required: false,
    })
    originalCode?: string;

    @ApiProperty({
        description: 'Место заказа (опционально)',
        example: 'Москва',
        required: false,
    })
    whereOrdered?: string;
}