/** Кирпич 1: цена поставщика в его валюте → рубли. У каждого поставщика свой. */
export interface ISupplierCurrency {
    /** Бросает Error, если валюту перевести нельзя (нет курса). */
    toRub(price: number, currency: string, rates: Record<string, number>): number;
}
