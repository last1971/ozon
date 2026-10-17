import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { SaleLine, SalePriceRef, SalePriceSource } from '../order/profit-check/profit-check.types';

/** Кто знает НАШУ цену продажи по заказу (проверка прибыльности). */
export interface ISalePriceSource {
    salePriceSource(): SalePriceSource;
    /** Для источника lookup: внешний id (SalePriceRef.externalId) → строки с нашей ценой. Одним запросом на всех. */
    lookupSalePrices(refs: SalePriceRef[]): Promise<Map<string, SaleLine[]>>;
}

export interface IOrderable extends ISalePriceSource {
    listAwaitingPackaging(): Promise<PostingDto[]>;
    listAwaitingDelivering(): Promise<PostingDto[]>;
    createInvoice(
        posting: PostingDto,
        transaction: FirebirdTransaction,
        flushers?: (() => Promise<void>)[],
    ): Promise<InvoiceDto | null>;
    listCanceled(): Promise<PostingDto[]>;
    getByPostingNumber(postingNumber: string): Promise<PostingDto>;
    getBuyerId(): number;
    isFbo(): boolean;
}
