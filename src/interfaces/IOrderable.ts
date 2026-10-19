import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { SaleFallbackRef, SaleLine, SalePriceRef, SalePriceSource } from '../order/profit-check/profit-check.types';

/** Кто знает НАШУ цену продажи по заказу (проверка прибыльности). */
export interface ISalePriceSource {
    salePriceSource(): SalePriceSource;
    /** Для источника lookup: внешний id (SalePriceRef.externalId) → строки с нашей ценой. Одним запросом на всех. */
    lookupSalePrices(refs: SalePriceRef[]): Promise<Map<string, SaleLine[]>>;
}

/**
 * Запасная наша цена, если основной поиск её так и не отдал (ВБ: статистика навсегда теряет ~5 % заказов,
 * проверено 19.10.2026). Цена — из карточки площадки на момент проверки, а не на момент заказа.
 * Необязательная возможность площадки: у кого её нет, заказ уходит в «не проверено», как раньше.
 */
export interface ISalePriceFallback {
    /** Внешний id заказа → строки с нашей ценой; заказ без цены хоть по одной строке — не возвращать. */
    fallbackSalePrices(refs: SaleFallbackRef[]): Promise<Map<string, SaleLine[]>>;
}

export const hasSalePriceFallback = (source: unknown): source is ISalePriceFallback =>
    typeof (source as ISalePriceFallback)?.fallbackSalePrices === 'function';

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
