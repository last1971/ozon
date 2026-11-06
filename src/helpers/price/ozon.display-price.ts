/** Требования Seller API к зачёркнутой цене, отдельно от формулы прибыли.
 * https://dev.ozon.ru/community/25
 * Цена продажи и минимальная цена не изменяются. 400 ₽ удовлетворяет обеим пограничным проверкам.
 */
export function ozonDisplayPrice(price: number, requested: number): number {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(requested) || requested < 0)
        throw new Error('Некорректная цена Ozon');
    if (requested === 0) return 0; // явное отключение зачёркнутой цены
    const minimum =
        price < 400
            ? Math.floor(price + 20) + 1
            : price <= 10000
              ? Math.floor(price / 0.95) + 1
              : Math.floor(price + 500) + 1;
    const old = Math.max(Math.ceil(requested), minimum);
    // Скидка >= 90% запрещена; не завышаем зачёркнутую цену до недопустимой.
    return old < price * 10 ? old : 0;
}
