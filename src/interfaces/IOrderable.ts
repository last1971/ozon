import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { FirebirdTransaction } from 'ts-firebird';

export interface IOrderable {
    listAwaitingPackaging(): Promise<PostingDto[]>;
    listAwaitingDelivering(): Promise<PostingDto[]>;
    createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto>;
    listCanceled(): Promise<PostingDto[]>;
    getByPostingNumber(postingNumber: string): Promise<PostingDto>;
    getBuyerId(): number;
    isFbo(): boolean;
}
