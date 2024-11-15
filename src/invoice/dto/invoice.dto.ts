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

    static map(invoices: any[]): InvoiceDto[] {
        return invoices.map(
            (invoice): InvoiceDto => ({
                id: invoice.SCODE,
                number: invoice.NS,
                status: invoice.STATUS,
                buyerId: invoice.POKUPATCODE,
                date: invoice.DATA,
                remark: invoice.PRIM,
            }),
        );
    }
}
