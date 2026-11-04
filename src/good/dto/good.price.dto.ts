/** Рыночная / остаток партий / все приходы / нет базы. */
export type PriceBaseSource = 'market' | 'remaining-lots' | 'all-receipts' | 'none';

export class GoodPriceDto {
    code: number;
    name: string;
    /** Закупочная цена за штуку. Рыночная цена своей фасовки выбирается отдельно. */
    price: number | null;
    base_source?: PriceBaseSource;
    /** Свободный остаток; нужен, чтобы рыночная цена не обходила запрет продажи без остатка. */
    free_stock?: number;
}
