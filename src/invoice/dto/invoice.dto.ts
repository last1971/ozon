import { InvoiceCreateDto } from './invoice.create.dto';
export class InvoiceDto extends InvoiceCreateDto {
    id: number;
    number?: number;
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
