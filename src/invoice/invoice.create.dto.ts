import { InvoiceLineDto } from './invoice.line.dto';

export class InvoiceCreateDto {
    buyerId: number;
    date: Date;
    remark: string;
    invoiceLines?: InvoiceLineDto[];
}
