import { InvoiceCreateDto } from '../invoice/invoice.create.dto';

export interface IInvoice {
    create(invoice: InvoiceCreateDto): Promise<boolean>;
    isExists(remark: string): Promise<boolean>;
}
export const INVOICE_SERVICE = 'INVOICE_SERVICE';
