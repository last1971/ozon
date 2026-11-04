/** Рыночная / остаток партий / все приходы / нет базы. */
export type PriceBaseSource = 'market' | 'remaining-lots' | 'all-receipts' | 'none';

export class GoodPriceDto {
    code: number;
    name: string;
    price: number | null;
    base_source?: PriceBaseSource;
}
