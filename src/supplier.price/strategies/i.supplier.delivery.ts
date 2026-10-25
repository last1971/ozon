/** Кирпич 2: сколько рублей за штуку добавить за доставку от поставщика. У каждого поставщика свой класс. */
export interface ISupplierDelivery {
    costRub(incomingRub: number, code: string): number;
}
