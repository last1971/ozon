/** Неизвестные внешние ошибки считаем временными: они не должны навсегда выключать товар. */
export type PricingFailureKind = 'data' | 'temporary';
export class PricingDataError extends Error {
    readonly name = 'PricingDataError';
}
export function pricingFailureKind(error: unknown): PricingFailureKind {
    if (error instanceof PricingDataError) return 'data';
    const e = error as { response?: { status?: number }; status?: number };
    return [400, 404, 422].includes(e?.response?.status ?? e?.status) ? 'data' : 'temporary';
}
