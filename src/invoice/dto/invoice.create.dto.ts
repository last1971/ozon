import { ApiProperty } from '@nestjs/swagger';
import { InvoiceLineDto } from './invoice.line.dto';

export class InvoiceCreateDto {
    @ApiProperty({ description: 'Идентификатор покупателя', example: 1 })
    buyerId: number;

    @ApiProperty({ description: 'Дата создания счета', example: '2023-11-13T00:00:00.000Z' })
    date: Date;

    @ApiProperty({ description: 'Примечание к счету', example: 'Заказ 123' })
    remark: string;

    @ApiProperty({
        description: 'Список строк счета',
        type: [InvoiceLineDto],
        required: false,
    })
    invoiceLines?: InvoiceLineDto[];
}
