/**
 * Цена покупателю на Ozon (проверено на всём каталоге обоих кабинетов 27.11.2026):
 *   покупателю = предельная цена × (1 − процент нашей seller-акции); акции Ozon её не снижают.
 * Наш процент НЕ ограничен min_price («Ограничение для акций и стратегий») — Ozon дно не защищает.
 */

/** Акция товара из /v5/product/info/prices → marketing_actions.actions. value — цена (Ozon-акции) или процент (наша). */
export interface MarketingActionDto {
    title: string;
    value: number;
    date_from: string;
    date_to: string;
}

/** Ozon округляет цену после скидки до рубля. При ровно 50 копейках выбирает меньшую цену. */
export const buyerPrice = (price: number, ozonActionPrices: number[], percent: number): number => {
    const base = Math.min(price, ...ozonActionPrices.filter((p) => p > 0));
    const discounted = (base * (100 - percent)) / 100;
    return Math.max(0, Math.ceil(discounted - 0.5));
};

/** Предельная цена, при которой с нашим процентом итог не ниже min_price. percent 0 → min_price. */
export const ozonActionFloor = (minPrice: number, percent: number): number => {
    if (percent <= 0) return minPrice;
    if (percent >= 100) throw new Error(`процент акции ${percent} не имеет смысла`);
    return Math.ceil(minPrice / (1 - percent / 100));
};
