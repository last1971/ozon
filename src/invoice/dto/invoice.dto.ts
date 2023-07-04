import { InvoiceCreateDto } from './invoice.create.dto';
export class InvoiceDto extends InvoiceCreateDto {
    id: number;
    number?: number;
    status: number;
}
