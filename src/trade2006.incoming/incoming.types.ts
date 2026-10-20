/** Приход в очереди: ключ — номер прихода (SKLADIN.NP / SHOPIN.NP = PRIHOD_MASTER.NPRIH). */
export interface IncomingPrihod {
    np: string;
    firstSeen: Date;
}

export interface IncomingContext {
    /** Сколько минут к приходу никто не прикасался, чтобы взять его в работу (0 — брать сразу). */
    settledMinutes: number;
    prihods: IncomingPrihod[];
    /** Коды товаров всех приходов прохода, без повторов. */
    skus: string[];
    /** Коды товаров по приходу (номер прихода → коды). */
    goodsByPrihod?: Map<string, string[]>;
    /** Коды Trade, которым цену посчитать не из чего (товара нет на складе) — их приходы ждут следующего прохода. */
    heldSkus?: string[];
    stopChain?: boolean;
}
