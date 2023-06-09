import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { PostingDto } from '../posting/dto/posting.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { ResultDto } from '../helpers/result.dto';

export interface IInvoice {
    create(invoice: InvoiceCreateDto): Promise<InvoiceDto>;
    isExists(remark: string): Promise<boolean>;
    getByPosting(posting: PostingDto): Promise<InvoiceDto>;
    updateByTransactions(transactions: TransactionDto[]): Promise<ResultDto>;
    pickupInvoice(invoice: InvoiceDto): Promise<void>;
}
export const INVOICE_SERVICE = 'INVOICE_SERVICE';
