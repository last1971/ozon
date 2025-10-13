import { InvoiceCreateDto } from './invoice.create.dto';
import { ApiProperty } from "@nestjs/swagger";
export class InvoiceDto extends InvoiceCreateDto {
    @ApiProperty({ description: 'Идентификатор счета', example: 123 })
    id: number;

    @ApiProperty({
        description: 'Номер счета (может отсутствовать)',
        example: 456,
        required: false,
    })
    number?: number;

    @ApiProperty({ description: 'Статус счета', example: 1 })
    status: number;

    @ApiProperty({
        description: 'Штрихкод',
        example: '1234567890123',
        required: false,
    })
    barcode?: string;

    @ApiProperty({
        description: 'Начало сборки',
        example: '2023-11-13T10:00:00.000Z',
        required: false,
    })
    assemblyStart?: Date;

    @ApiProperty({
        description: 'Окончание сборки',
        example: '2023-11-13T12:00:00.000Z',
        required: false,
    })
    assemblyEnd?: Date;

    static map(invoices: any[]): InvoiceDto[] {
        return invoices.map(
            (invoice): InvoiceDto => ({
                id: invoice.SCODE,
                number: invoice.NS,
                status: invoice.STATUS,
                buyerId: invoice.POKUPATCODE,
                date: invoice.DATA,
                remark: invoice.PRIM,
                barcode: invoice.IGK,
                assemblyStart: invoice.START_PICKUP,
                assemblyEnd: invoice.FINISH_PICKUP,
            }),
        );
    }
}
