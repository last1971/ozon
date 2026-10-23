/**
 * Цена покупателю на Ozon при наложении акций (проверено на 604 товарах 19.10.2026, ±1 ₽):
 *   покупателю = min(цены Ozon-акций товара, наша price) × (1 − процент нашей seller-акции).
 * Наш процент накладывается ПОВЕРХ цены любой Ozon-акции и НЕ ограничен min_price — Ozon дно не защищает.
 * Отсюда пол для Ozon-акций: action_price ≥ min_price / (1 − percent), иначе итог уйдёт ниже минимума.
 */

/** Акция товара из /v5/product/info/prices → marketing_actions.actions. value — цена (Ozon-акции) или процент (наша). */
export interface MarketingActionDto {
    title: string;
    value: number;
    date_from: string;
    date_to: string;
}

/** Рассрочки и АБ-тесты Ozon тоже лежат в marketing_actions, но их value — процент, не цена. */
const NOT_PRICE_ACTION = ['Рассрочк', 'АБ тест'];

/** Акция идёт в момент now; без дат — считаем идущей. */
const runsAt = (a: MarketingActionDto, now: Date): boolean =>
    !(Date.parse(a.date_from) > now.getTime()) && !(Date.parse(a.date_to) < now.getTime());

/**
 * Оставить только акции, задающие ЦЕНУ СЕЙЧАС: идут в момент now (будущая цену покупателю не меняет —
 * Супербустинг 30.10 на 513498, 23.10.2026), не рассрочка/АБ-тест, не наша акция (её value — процент)
 * и value похож на цену (не меньше трети min_price — отсекает проценты вроде 4/12/24 у дорогих товаров).
 */
export const ozonPriceActions = (
    actions: MarketingActionDto[] | undefined,
    minPrice: number,
    ourTitle?: string,
    now: Date = new Date(),
): MarketingActionDto[] =>
    (actions ?? []).filter(
        (a) =>
            a.value > 0 &&
            runsAt(a, now) &&
            (!ourTitle || a.title !== ourTitle) &&
            !NOT_PRICE_ACTION.some((k) => a.title.includes(k)) &&
            a.value >= minPrice * 0.3,
    );

/** Цена покупателю: min(цены Ozon-акций, price) × (1 − percent/100), округление до рубля. */
export const buyerPrice = (price: number, ozonActionPrices: number[], percent: number): number => {
    const base = Math.min(price, ...ozonActionPrices.filter((p) => p > 0));
    return Math.round(base * (1 - percent / 100));
};

/** Пол для action_price Ozon-акций, чтобы с нашим процентом сверху итог не ушёл ниже min_price. percent 0 → min_price. */
export const ozonActionFloor = (minPrice: number, percent: number): number => {
    if (percent <= 0) return minPrice;
    if (percent >= 100) throw new Error(`процент акции ${percent} не имеет смысла`);
    return Math.ceil(minPrice / (1 - percent / 100));
};
