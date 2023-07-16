import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';

export interface IOrderable {
    listAwaitingPackaging(): Promise<PostingDto[]>;
    listAwaitingDelivering(): Promise<PostingDto[]>;
    createInvoice(posting: PostingDto): Promise<InvoiceDto>;
}
