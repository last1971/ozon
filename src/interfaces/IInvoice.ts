import { InvoiceCreateDto } from '../invoice/dto/invoice.create.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { PostingDto } from '../posting/dto/posting.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { ResultDto } from '../helpers/dto/result.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { InvoiceGetDto } from '../invoice/dto/invoice.get.dto';
import { InvoiceLineDto } from '../invoice/dto/invoice.line.dto';
import { InvoiceUpdateDto } from "../invoice/dto/invoice.update.dto";

export interface IInvoice {
    getTransaction(): Promise<FirebirdTransaction>;
    create(invoice: InvoiceCreateDto, t: FirebirdTransaction): Promise<InvoiceDto>;
    isExists(remark: string, t: FirebirdTransaction): Promise<boolean>;
    updatePrim(prim: string, newPrim: string, t: FirebirdTransaction): Promise<void>;
    getByPosting(posting: PostingDto | string, t: FirebirdTransaction, containing?: boolean): Promise<InvoiceDto>;
    getByPostingNumbers(postingNumbers: string[]): Promise<InvoiceDto[]>;
    getByBuyerAndStatus(buyerId: number, status: number, t: FirebirdTransaction): Promise<InvoiceDto[]>;
    updateByCommissions(commissions: Map<string, number>, t: FirebirdTransaction): Promise<ResultDto>;
    updateByTransactions(transactions: TransactionDto[], t: FirebirdTransaction): Promise<ResultDto>;
    pickupInvoice(invoice: InvoiceDto, t: FirebirdTransaction): Promise<void>;
    createInvoiceFromPostingDto(buyerId: number, posting: PostingDto, t: FirebirdTransaction): Promise<InvoiceDto>;
    unPickupOzonFbo(product: ProductPostingDto, prim: string, transaction: FirebirdTransaction): Promise<boolean>;
    deltaGood(id: string, quantity: number, prim: string, transaction: FirebirdTransaction): Promise<void>;
    getByDto(invoiceGetDto: InvoiceGetDto): Promise<InvoiceDto[]>;
    getInvoiceLines(invoice: InvoiceDto, transaction: FirebirdTransaction): Promise<InvoiceLineDto[]>;
    unPickupAndDeltaInvoice(invoice: InvoiceDto, transaction: FirebirdTransaction): Promise<void>;
    bulkSetStatus(invoices: InvoiceDto[], status: number, transaction: FirebirdTransaction): Promise<void>;
    update(invoice: InvoiceDto, invoiceUpdateDto: InvoiceUpdateDto, t?: FirebirdTransaction): Promise<boolean>;
    distributePaymentByUPD(updNumber: number, updDate: string, amount: number): Promise<ResultDto>;
}
export const INVOICE_SERVICE = 'INVOICE_SERVICE';
