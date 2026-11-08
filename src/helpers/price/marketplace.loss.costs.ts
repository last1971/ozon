/** Проверенные входы на одну продажу своей площадки и фасовки. NULL — нет данных. */
export interface MarketplaceLossCostsInput {
    /** Именно закупочная стоимость упаковки, независимо от ручной рыночной базы цены. */
    purchaseCost: number | null;
    defectRate: number | null;
    /** Только возмещение закупки подтверждённых списаний; скидки/услуги сюда не входят. */
    confirmedDefectCompensation: number | null;
    /** У ВБ — собственная проверенная доставка оплаченных возвратов в обе стороны.
     * Отсутствие поля сохраняет расчёт по тарифам Ozon; NULL остаётся неизвестным в статистике. */
    paidReturnDelivery?: number | null;
    cancellationDelivery: number | null;
    sellerReturnDelivery: number | null;
}
export interface MarketplaceLossCosts {
    returns: number;
    cancellations: number;
    sellerReturns: number;
    defects: number;
    defectCompensation: number;
    total: number;
}
function amount(value: unknown, name: string, signed = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || (!signed && value < 0))
        throw new Error(`Нет корректных данных расходов: ${name}`);
    return value;
}
/** Неизвестные дополнительные расходы подставляются только при расчёте, без изменения статистики. */
function optionalAmount(value: unknown, name: string, signed = false): number {
    return value == null ? 0 : amount(value, name, signed);
}
/** Одна тарифная формула возврата; неизвестная сторона не выдаётся за полный тариф. */
export function calculateTariffReturnDelivery(
    returnRate: number | null | undefined,
    direct: number | null | undefined,
    reverse: number | null | undefined,
): number {
    const rate = optionalAmount(returnRate, 'доля возвратов Ozon');
    if (rate > 1) throw new Error('Некорректная доля возвратов Ozon');
    if (direct != null) amount(direct, 'тарифа прямой логистики Ozon');
    if (reverse != null) amount(reverse, 'тарифа обратной логистики Ozon');
    if (direct == null || reverse == null) return 0;
    return rate * (direct + reverse);
}
/** Единственное место суммирования потерь. Проценты выбирает существующая политика площадки. */
export function calculateMarketplaceLossCosts(
    input: MarketplaceLossCostsInput | undefined,
    tariffReturnDelivery: number,
): MarketplaceLossCosts {
    const returns = optionalAmount(
        input?.paidReturnDelivery === undefined ? tariffReturnDelivery : input.paidReturnDelivery,
        'доставка оплаченных возвратов',
        true,
    );
    if (!input)
        return { returns, cancellations: 0, sellerReturns: 0, defects: 0, defectCompensation: 0, total: returns };
    const rate = optionalAmount(input.defectRate, 'доля брака');
    const gross = rate === 0 ? 0 : amount(input.purchaseCost, 'закупочная стоимость') * rate;
    const confirmed = optionalAmount(input.confirmedDefectCompensation, 'подтверждённое возмещение брака');
    // Компенсация не превращает резерв потерь закупки в доход и не погашает доставку.
    const defectCompensation = Math.min(gross, confirmed);
    const defects = gross - defectCompensation;
    const cancellations = optionalAmount(input.cancellationDelivery, 'доставка при отказах', true);
    const sellerReturns = optionalAmount(input.sellerReturnDelivery, 'возврат продавцу', true);
    const total = returns + cancellations + sellerReturns + defects;
    if (![gross, defects, total].every(Number.isFinite)) throw new Error('Переполнение расходов на потери');
    return { returns, cancellations, sellerReturns, defects, defectCompensation, total };
}
