/** Проверенные входы на одну продажу своей площадки и фасовки. NULL — нет данных. */
export interface MarketplaceLossCostsInput {
    /** Именно закупочная стоимость упаковки, независимо от ручной рыночной базы цены. */
    purchaseCost: number | null;
    defectRate: number | null;
    /** Только возмещение закупки подтверждённых списаний; скидки/услуги сюда не входят. */
    confirmedDefectCompensation: number;
    /** У ВБ — собственная проверенная доставка оплаченных возвратов в обе стороны.
     * Отсутствие поля сохраняет расчёт по тарифам Ozon; NULL не означает бесплатную доставку. */
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
/** Единственное место суммирования потерь. Проценты выбирает существующая политика площадки. */
export function calculateMarketplaceLossCosts(
    input: MarketplaceLossCostsInput | undefined,
    tariffReturnDelivery: number,
): MarketplaceLossCosts {
    const returns = amount(
        input?.paidReturnDelivery === undefined ? tariffReturnDelivery : input.paidReturnDelivery,
        'доставка оплаченных возвратов',
        true,
    );
    if (!input)
        return { returns, cancellations: 0, sellerReturns: 0, defects: 0, defectCompensation: 0, total: returns };
    const rate = amount(input.defectRate, 'доля брака');
    const gross = rate === 0 ? 0 : amount(input.purchaseCost, 'закупочная стоимость') * rate;
    const confirmed = amount(input.confirmedDefectCompensation, 'подтверждённое возмещение брака');
    // Компенсация не превращает резерв потерь закупки в доход и не погашает доставку.
    const defectCompensation = Math.min(gross, confirmed);
    const defects = gross - defectCompensation;
    const cancellations = amount(input.cancellationDelivery, 'доставка при отказах', true);
    const sellerReturns = amount(input.sellerReturnDelivery, 'возврат продавцу', true);
    const total = returns + cancellations + sellerReturns + defects;
    if (![gross, defects, total].every(Number.isFinite)) throw new Error('Переполнение расходов на потери');
    return { returns, cancellations, sellerReturns, defects, defectCompensation, total };
}
