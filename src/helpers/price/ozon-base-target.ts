import type { UpdatePriceDto } from '../../price/dto/update.price.dto';
import type { PromoPriceState } from '../../promos/price-lever/promo-price.types';
import { buyerPrice } from './buyer.price.helper';
import { ozonDisplayPrice } from './ozon.display-price';

/** The economic minimum is a buyer price. The imported price is before the seller discount. */
export function resolveOzonBaseTarget(
    target: UpdatePriceDto,
    state: Pick<PromoPriceState, 'seller' | 'calcMinPrice' | 'deadZoneFloor'>,
): UpdatePriceDto {
    if (!target.ozonCalculated || !state.seller?.isActive) return target;
    const percent = state.seller.minPercent;
    const minimum = Math.max(Number(target.min_price), state.calcMinPrice ?? 0);
    const normal = Number(target.price);
    const requestedOld = Number(target.old_price);
    if (
        !(percent > 0 && percent < 100) ||
        !Number.isSafeInteger(minimum) ||
        minimum < 1 ||
        !Number.isSafeInteger(normal) ||
        normal < minimum ||
        target.old_price == null ||
        !Number.isFinite(requestedOld) ||
        requestedOld < 0
    )
        return target;

    // A lower price remains attainable with a deeper discount when the low tariff applies.
    // Only lift the base when even the smallest permissible discount cannot reach the minimum.
    if (buyerPrice(normal, [], percent) >= minimum) return target;
    const floor = minimum > 300 ? Math.max(minimum, state.deadZoneFloor ?? 0, target.ozonDeadZoneFloor ?? 0) : minimum;
    // Invert Ozon's half-down rounding. An exact minimum - 0.50 is still below the minimum.
    const base = Math.floor(((floor - 0.5) * 100) / (100 - percent)) + 1;
    if (!Number.isSafeInteger(base) || buyerPrice(base, [], percent) < floor) return target;
    return {
        ...target,
        price: String(base),
        old_price: String(ozonDisplayPrice(base, requestedOld)),
    };
}

/** V5 identifies the underlying price only when no active promotion can account for that price. */
export function observedOzonBase(state: PromoPriceState, now = new Date()): number | undefined {
    if (
        !Number.isFinite(state.price) ||
        state.price <= 0 ||
        !Number.isFinite(state.buyerPrice) ||
        state.buyerPrice <= 0 ||
        state.buyerPrice !== state.buyerPriceCalc
    )
        return undefined;
    const obscured = state.ozonActions.some((action) => {
        if (!action.participant) return false;
        const start = action.startsAt ? Date.parse(action.startsAt) : -Infinity;
        if (Number.isNaN(start) || !Number.isFinite(action.actionPrice) || action.actionPrice <= 0) return true;
        return start <= +now && action.actionPrice <= state.price;
    });
    return obscured ? undefined : state.price;
}
