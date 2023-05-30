import { InvoiceLineDto } from './invoice.line.dto';

export class Invoice {
    buyerId: number;
    date: Date;
    invoiceLines?: InvoiceLineDto[];
}
