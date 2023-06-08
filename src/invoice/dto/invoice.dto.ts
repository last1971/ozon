import { InvoiceCreateDto } from './invoice.create.dto';
export class InvoiceDto extends InvoiceCreateDto {
    id: number;
    status: number;
}
