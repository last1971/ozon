import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { PostingDto } from '../posting/dto/posting.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { ResultDto } from '../helpers/result.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { ProductPostingDto } from '../product/dto/product.posting.dto';

export interface IInvoice {
    getTransaction(): Promise<FirebirdTransaction>;
    create(invoice: InvoiceCreateDto, t: FirebirdTransaction): Promise<InvoiceDto>;
    isExists(remark: string, t: FirebirdTransaction): Promise<boolean>;
    getByPosting(posting: PostingDto, t: FirebirdTransaction): Promise<InvoiceDto>;
    getByBuyerAndStatus(buyerId: number, status: number, t: FirebirdTransaction): Promise<InvoiceDto[]>;
    updateByCommissions(commissions: Map<string, number>, t: FirebirdTransaction): Promise<ResultDto>;
    updateByTransactions(transactions: TransactionDto[], t: FirebirdTransaction): Promise<ResultDto>;
    pickupInvoice(invoice: InvoiceDto, t: FirebirdTransaction): Promise<void>;
    createInvoiceFromPostingDto(buyerId: number, posting: PostingDto, t: FirebirdTransaction): Promise<InvoiceDto>;
    unPickupOzonFbo(product: ProductPostingDto, prim: string, transaction: FirebirdTransaction): Promise<void>;
}
export const INVOICE_SERVICE = 'INVOICE_SERVICE';
