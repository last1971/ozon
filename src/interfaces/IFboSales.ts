/**
 * Источник FBO-продаж площадки для наблюдателя `FboSalesObserverService`:
 * номера доставленных покупателю FBO-отправлений за окно площадки.
 * Что с ними делать (журнал, вывод кода из оборота), решает наблюдатель.
 */
export interface IFboSales {
    listDeliveredFbo(): Promise<string[]>;
}
