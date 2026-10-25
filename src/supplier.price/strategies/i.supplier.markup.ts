export interface SupplierMarkupResult {
    price: number;
    old_price: number;
    min_price: number;
    min_perc: number;
    perc: number;
    old_perc: number;
}

/** Кирпич 3: закупка в рублях (с доставкой) → цены на сайте. */
export interface ISupplierMarkup {
    apply(code: string, costRub: number): SupplierMarkupResult;
}
