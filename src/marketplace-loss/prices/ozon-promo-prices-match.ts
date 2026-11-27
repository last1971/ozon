import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { effectiveMinimum, planOzonPrice } from '../../promos/price-lever/promo-price.planner';
import { PromoPriceState } from '../../promos/price-lever/promo-price.types';

/** Цена в Ozon уже по правилу для этой расчётной минимальной: отправлять нечего. */
export function ozonPromoPricesMatch(target: UpdatePriceDto, actual: unknown): boolean {
    const state = (actual as { promoState?: PromoPriceState } | undefined)?.promoState;
    if (!state || state.offerId !== target.offer_id) return false;
    const plan = planOzonPrice(
        state,
        effectiveMinimum(Number(target.min_price), target.ozonDeadZoneFloor),
        Number(target.old_price),
    );
    return plan.ok && !plan.steps.length;
}
