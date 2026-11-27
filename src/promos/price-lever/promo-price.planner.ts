import { buyerPrice, ozonActionFloor } from '../../helpers/price/buyer.price.helper';
import { ozonDisplayPrice } from '../../helpers/price/ozon.display-price';
import type { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { PromoPricePlan, PromoPriceState, PromoPriceStep, SellerSlot } from './promo-price.types';

/**
 * Единственное правило цены Ozon (решение владельца 27.11.2026):
 *   p — процент нашей акции у товара-участника, не ниже минимального процента акции; не участник — 0;
 *   предельная P — наименьшая цена, при которой покупатель P × (1 − p) платит не меньше нашей минимальной M;
 *   ограничение (min_price) = M, зачёркнутая — из расчёта.
 * Акции Ozon цену не меняют и сами берут товар, если P не выше их порога, — в них не пишем.
 * Процент считаем и при выключенной акции: включение акции не должно уводить цену ниже минимальной.
 */
export const sellerPercent = (seller: SellerSlot | null): number =>
    seller?.isActive ? Math.max(seller.percent, seller.minPercent) : 0;

/** Наименьшая предельная цена, при которой покупатель с процентом percent платит не меньше minimum. */
export function limitPrice(minimum: number, percent: number): number {
    let price = ozonActionFloor(minimum, percent);
    while (price > 1 && buyerPrice(price - 1, [], percent) >= minimum) price--;
    return price;
}

/** Тариф P300: покупатель платит не больше 300 или не меньше верхней ступени. */
export const effectiveMinimum = (minimum: number, deadZoneFloor?: number): number =>
    minimum > 300 && deadZoneFloor > minimum ? deadZoneFloor : minimum;

/**
 * План для товара: импорт цены, если предельная, ограничение или зачёркнутая отличаются от правила,
 * и процент нашей акции вниз до минимального. Предельная считается от текущего процента — он не ниже
 * минимального, поэтому цена не уходит ниже минимальной ни до, ни после смены процента.
 */
export function planOzonPrice(
    s: PromoPriceState,
    minimum: number,
    oldPrice: number,
    base: Partial<UpdatePriceDto> = {},
): PromoPricePlan {
    const percent = sellerPercent(s.seller);
    const priced = Number.isSafeInteger(minimum) && minimum > 0;
    const price = priced ? limitPrice(minimum, percent) : s.price;
    const old = priced ? ozonDisplayPrice(price, oldPrice) : s.oldPrice;
    const steps: PromoPriceStep[] = [];
    if (priced && (price !== s.price || minimum !== s.minPrice || old !== s.oldPrice))
        steps.push({
            kind: 'base',
            target: {
                currency_code: 'RUB',
                ...base,
                offer_id: s.offerId,
                price: String(price),
                min_price: String(minimum),
                old_price: String(old),
            } as UpdatePriceDto,
        });
    const seller = s.seller;
    if (priced && seller?.isActive && seller.percent > seller.minPercent)
        steps.push({
            kind: 'percent',
            actionId: seller.actionId,
            sku: seller.sku,
            from: seller.percent,
            to: seller.minPercent,
        });
    const finalPercent = seller?.isActive ? seller.minPercent : 0;
    const buyerAfter = buyerPrice(price, [], finalPercent);
    return {
        offerId: s.offerId,
        productId: s.productId,
        target: minimum,
        percent,
        price,
        steps,
        buyerBefore: s.buyerPrice,
        buyerAfter,
        ok: priced && buyerAfter >= minimum,
        notes: priced ? [] : ['Нет минимальной цены — нужен пересчёт цены товара'],
        state: s,
    };
}

/**
 * Сторож: минимальная берётся из Ozon, а она может быть старой (27.11.2026: 537572 — 5110 в Ozon при
 * расчётной 5527). По ней можно только поднять цену и вернуть процент к минимальному; опускает к
 * минимальной лишь пересчёт цены со свежим расчётом.
 */
export function guardPlan(s: PromoPriceState): PromoPricePlan {
    const plan = planOzonPrice(s, s.minPrice, s.oldPrice);
    if (plan.price > s.price) return plan;
    const finalPercent = s.seller?.isActive ? s.seller.minPercent : 0;
    const buyerAfter = buyerPrice(
        s.price,
        [],
        plan.steps.some((step) => step.kind === 'percent') ? finalPercent : plan.percent,
    );
    return {
        ...plan,
        price: s.price,
        steps: plan.steps.filter((step) => step.kind !== 'base'),
        buyerAfter,
        ok: plan.ok && buyerAfter >= plan.target,
    };
}
