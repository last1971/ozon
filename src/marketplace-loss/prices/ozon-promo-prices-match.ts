import { ozonPricesMatch } from '../../helpers/price/ozon-prices-match';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { planPromoPrice } from '../../promos/price-lever/promo-price.planner';
import { PromoPriceState } from '../../promos/price-lever/promo-price.types';

/**
 * Проверяет конечный результат normal → акции к минимуму. Суммы и условия берутся заново,
 * поэтому проверка переживает рестарт и не скрывает новую себестоимость / новый минимум.
 * Расчётная normal — только вход чистого планировщика; наблюдаемое состояние не изменяем.
 */
export function ozonPromoPricesMatch(target: UpdatePriceDto, actual: unknown, now = new Date()): boolean {
    const state = (actual as { promoState?: PromoPriceState } | undefined)?.promoState;
    if (!state || state.offerId !== target.offer_id) return false;
    const normal = Number(target.price),
        minimum = Number(target.min_price);
    if (!Number.isFinite(normal) || !Number.isFinite(minimum) || minimum <= 0 || normal < minimum) return false;
    // Только price может отличаться от normal. min_price и old_price обязаны совпасть точно.
    if (!ozonPricesMatch({ ...target, price: String(state.price) }, actual, 0)) return false;
    const plan = planPromoPrice(
        { ...state, price: normal, minPrice: minimum, calcMinPrice: minimum },
        'min',
        undefined,
        now,
    );
    const priceMatches =
        state.price === normal ||
        (state.price === plan.baseAfter &&
            state.ozonActions.some((action) => action.participant && action.actionPrice === state.price));
    return (
        plan.ok &&
        priceMatches &&
        state.buyerPrice === plan.buyerAfter &&
        state.buyerPriceCalc === state.buyerPrice &&
        // Кандидат или более дорогая акция не меняют уже достигнутую цену покупателю.
        // Повышение слишком дешёвой акции, исключение и смена процента требуют обработки.
        plan.steps.every((step) => step.kind === 'ozon-set' && (step.from === null || step.from >= step.to))
    );
}
