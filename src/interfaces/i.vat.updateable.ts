/**
 * Интерфейс для сервисов, поддерживающих обновление ставки НДС
 * Работает только с числами, каждый сервис внутри конвертирует в свой формат для API
 */
export interface IVatUpdateable {
    /**
     * Проверить все товары на несоответствие ставки НДС
     * @param expectedVat - ожидаемая ставка НДС (число)
     * @param limit - лимит записей за запрос
     * @returns список несоответствий
     */
    checkVatForAll(
        expectedVat: number,
        limit?: number,
    ): Promise<Array<{ offer_id: string; current_vat: number; expected_vat: number }>>;

    /**
     * Обновить ставку НДС для списка товаров
     * @param offerIds - список offer_id
     * @param vat - новая ставка НДС (число)
     * @returns результат обновления
     */
    updateVat(offerIds: string[], vat: number): Promise<any>;

    /**
     * Преобразовать значение НДС (любой формат) в число для сравнения
     * @param vat - значение НДС в формате маркетплейса
     * @returns число для сравнения
     */
    vatToNumber(vat: any): number;

    /**
     * Преобразовать число в формат НДС маркетплейса
     * @param vat - число
     * @returns значение НДС в формате маркетплейса (string | number | enum)
     */
    numberToVat(vat: number): any;
}
