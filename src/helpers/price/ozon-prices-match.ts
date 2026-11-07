/** Сравнение только трёх отправляемых сумм. Нет ответа/числа — нет подтверждения. */
export function ozonPricesMatch(
    sent: { price?: unknown; old_price?: unknown; min_price?: unknown },
    actual: unknown,
    tolerance = 1,
): boolean {
    return (
        !!actual &&
        (['price', 'old_price', 'min_price'] as const).every((key) => {
            const a = (actual as Record<string, unknown>)[key];
            const s = sent[key];
            return (
                a !== null &&
                a !== undefined &&
                s !== null &&
                s !== undefined &&
                Number.isFinite(Number(a)) &&
                Number.isFinite(Number(s)) &&
                Math.abs(Number(s) - Number(a)) <= tolerance
            );
        })
    );
}
