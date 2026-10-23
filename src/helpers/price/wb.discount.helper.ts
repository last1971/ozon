/**
 * Скидка ВБ, %, при которой цена покупателю base × (1 − скидка) не ниже target.
 * Единственная формула скидки ВБ: ей пользуются пересчёт цен (updatePrices) и ручка «до минимальной».
 * floor, а не round: округление вверх дало бы бо́льшую скидку и цену ниже target. Отрицательной не бывает.
 */
export const wbDiscountTo = (base: number, target: number): number =>
    Math.max(0, Math.floor((1 - target / base) * 100));
