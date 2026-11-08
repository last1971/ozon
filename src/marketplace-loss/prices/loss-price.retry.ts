import type { PricingFailureKind } from '../../helpers/price/pricing-error';
import { matchesPricingInputs, PricingInputsChanged } from '../../helpers/price/pricing-inputs-changed';
import type { LossPricePayload } from './loss-price.contracts';

export const LOSS_DATA_RETRY_MS = 60 * 60_000;
// Частоту временных повторов задаёт существующий cron; не добавляем вторую задержку после его тика.
export const LOSS_TEMPORARY_RETRY_MS = 0;
export const lossPriceRetryDelay = (kind: PricingFailureKind) =>
    kind === 'data' ? LOSS_DATA_RETRY_MS : LOSS_TEMPORARY_RETRY_MS;

/** Состояние повтора живёт в PAYLOAD MP_EVENT; неизвестные/повреждённые метаданные не замораживают задание. */
export function lossPriceRetryDue(
    payload: unknown,
    force = false,
    wake?: PricingInputsChanged,
    now = Date.now(),
): boolean {
    const row = payload as LossPricePayload;
    if (force || matchesPricingInputs(row?.offerId, wake)) return true;
    if (!row?.lastError || !['data', 'temporary'].includes(row.retryKind)) return true;
    const attempted = Date.parse(row.attemptedAt),
        next = Date.parse(row.nextAttemptAt);
    if (
        !Number.isFinite(attempted) ||
        attempted > now ||
        !Number.isFinite(next) ||
        next < attempted ||
        next - attempted > lossPriceRetryDelay(row.retryKind)
    )
        return true;
    return now >= next;
}
