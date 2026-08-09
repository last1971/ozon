/**
 * Цена товара в отправлении: приведение формата новых ручек к прежнему.
 *
 * В /v3/posting/fbs/list и /v2/posting/fbo/list цена приходила строкой
 * ("4099.0000"), а в пришедших им на смену /v4 и /v3 — объектом
 * {"amount": "4099", "currency": "RUB"}. parseFloat от объекта даёт NaN,
 * и создание счёта падало на Firebird с -303 Conversion error from string "NaN".
 *
 * Нормализуем сразу на границе с API: ниже по течению цена везде ожидается
 * строкой, и переучивать весь код ради формы ответа Ozon незачем.
 */
export function normalizePostingPrice(price: unknown): string {
    if (price === null || price === undefined) return '0';
    if (typeof price === 'object') {
        const amount = (price as { amount?: unknown }).amount;
        return amount === null || amount === undefined ? '0' : String(amount);
    }
    return String(price);
}

/** Приводит цены во всех товарах отправлений; остальные поля не трогает. */
export function normalizePostingsPrices<T extends { postings?: any[] }>(response: T): T {
    for (const posting of response?.postings ?? []) {
        for (const product of posting?.products ?? []) {
            product.price = normalizePostingPrice(product.price);
        }
    }
    return response;
}
