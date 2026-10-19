import { buyerPrice, ozonActionFloor } from '../../helpers/price/buyer.price.helper';
import { OzonActionSlot, PromoPricePlan, PromoPriceState, PromoPriceStep, PromoTarget } from './promo-price.types';

/** Цель в рублях: 'min' → min_price, 'normal' → price, число как есть. Неизвестная строка → ошибка. */
export const targetRubles = (s: PromoPriceState, target: PromoTarget): number => {
    if (target === 'min') return s.minPrice;
    if (target === 'normal') return s.price;
    const t = Number(target);
    if (!(t > 0)) throw new Error(`цель «${target}» — не min, не normal и не цена`);
    return t;
};

/**
 * План для одного товара (решения 19.10.2026). Ничего не вызывает — только считает.
 *
 * 1. Наш процент: участник нашей акции — max(minPercent, заданный); не участник — 0 (сначала пробуем без неё).
 * 2. Пол для Ozon-акций: min_price / (1 − процент).
 * 3. Каждая Ozon-акция: лимит ≥ пола → остаёмся/добавляемся по цене под цель, но в [пол, лимит];
 *    лимит < пола → участник выкидывается, кандидат пропускается. Промокодные: цену не трогаем, только выкидываем.
 * 4. Ozon-акций не осталось → цену держит наша акция: процент под цель от price, не ниже minPercent
 *    и не глубже дна. Кандидат нашей акции в этом случае в неё добавляется.
 */
export const planPromoPrice = (s: PromoPriceState, target: PromoTarget, percentWanted?: number): PromoPricePlan => {
    const notes: string[] = [];
    const steps: PromoPriceStep[] = [];

    const wanted = targetRubles(s, target);
    const t = Math.min(s.price, Math.max(s.minPrice, wanted));
    if (t !== wanted) notes.push(`цель ${wanted} вне коридора [${s.minPrice}, ${s.price}] — взята ${t}`);

    const seller = s.seller;
    if (!seller && percentWanted)
        notes.push('товара нет среди участников и кандидатов нашей акции — процент не назначить');
    let percent = seller?.isActive ? Math.max(seller.minPercent, percentWanted ?? seller.minPercent) : 0;
    if (seller?.isActive && percentWanted !== undefined && percentWanted < seller.minPercent) {
        notes.push(`процент ${percentWanted} ниже минимума акции ${seller.minPercent} — взят ${seller.minPercent}`);
    }

    const floor = ozonActionFloor(s.minPrice, percent);
    const need = Math.ceil(t / (1 - percent / 100));
    const kept: number[] = [];

    for (const a of s.ozonActions) {
        const fits = a.maxActionPrice > 0 && a.maxActionPrice >= floor;
        if (a.isVoucher) {
            if (a.participant && a.actionPrice > 0 && a.actionPrice < floor) {
                steps.push(removeStep(a, `промокодная, цена ${a.actionPrice} < пол ${floor}`));
            } else if (a.participant) {
                kept.push(a.actionPrice);
            }
            continue;
        }
        if (!fits) {
            if (a.participant) steps.push(removeStep(a, `лимит ${a.maxActionPrice} < пол ${floor}`));
            else notes.push(`«${a.title}»: лимит ${a.maxActionPrice} < пол ${floor} — не добавляем`);
            continue;
        }
        const to = Math.min(a.maxActionPrice, Math.max(floor, need));
        kept.push(to);
        if (to < need) notes.push(`«${a.title}»: лимит ${a.maxActionPrice} не даёт поднять цену до цели`);
        if (!a.participant || a.actionPrice !== to) {
            steps.push({
                kind: 'ozon-set',
                actionId: a.actionId,
                title: a.title,
                from: a.participant ? a.actionPrice : null,
                to,
            });
        }
    }

    if (!kept.length && seller) {
        const pNeed = Math.round((1 - t / s.price) * 100);
        const pMax = Math.floor((1 - s.minPrice / s.price) * 100 + 1e-9);
        percent = Math.max(seller.minPercent, percentWanted ?? pNeed);
        if (percent > pMax) {
            if (pMax >= seller.minPercent) {
                notes.push(`процент ${percent} уводит ниже дна — взят ${pMax}`);
                percent = pMax;
            } else {
                notes.push(`даже минимальный процент ${seller.minPercent} уводит ниже дна: price ${s.price} мал`);
                percent = seller.minPercent;
            }
        }
    } else if (!kept.length) {
        notes.push('ни Ozon-акций, ни нашей акции — цена покупателю = price');
    }

    if (seller && (kept.length === 0 || seller.isActive) && (!seller.isActive || seller.percent !== percent)) {
        steps.push({
            kind: 'percent',
            actionId: seller.actionId,
            sku: seller.sku,
            from: seller.isActive ? seller.percent : null,
            to: percent,
        });
    }

    const buyerAfter = buyerPrice(s.price, kept, percent);
    return {
        offerId: s.offerId,
        productId: s.productId,
        target: t,
        percent,
        floor,
        steps,
        buyerBefore: s.buyerPrice,
        buyerAfter,
        ok: buyerAfter >= s.minPrice,
        notes,
        state: s,
    };
};

const removeStep = (a: OzonActionSlot, reason: string): PromoPriceStep => ({
    kind: 'ozon-remove',
    actionId: a.actionId,
    title: a.title,
    from: a.actionPrice,
    reason,
});
