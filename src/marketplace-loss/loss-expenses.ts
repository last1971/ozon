import type { MarketplaceLossCostsInput } from '../helpers/price/marketplace.loss.costs';

/** Подтверждённые суммы за то же 90-дневное окно. Неизвестные расходы — NULL. */
export interface LossExpenseTotals {
    paidReturnDelivery?: number | null;
    cancellationDelivery: number | null;
    sellerReturnDelivery: number | null;
    confirmedDefectCompensation: number;
}
export const lossExpenseFields = [
    'paidReturnDelivery',
    'cancellationDelivery',
    'sellerReturnDelivery',
    'confirmedDefectCompensation',
] as const;
export function validateLossExpenses(expenses: LossExpenseTotals): LossExpenseTotals {
    if (!expenses || typeof expenses !== 'object') throw new Error('Нет сумм расходов на потери');
    const result = {} as LossExpenseTotals;
    for (const field of lossExpenseFields) {
        const value = expenses[field];
        if (field === 'paidReturnDelivery' && value === undefined) continue; // Ozon: действующая политика и тарифы.
        const compensation = field === 'confirmedDefectCompensation';
        if (
            !(value === null && !compensation) &&
            (typeof value !== 'number' || !Number.isFinite(value) || (compensation && value < 0))
        )
            throw new Error(`Некорректные расходы на потери: ${field}`);
        result[field] = value;
    }
    return result;
}
/** Отказы не уменьшают знаменатель. Ни одна другая площадка/фасовка не подставляется. */
export function lossExpensesPerSale(row: {
    soldUnits: number | null;
    defectRate: number | null;
    expenses?: LossExpenseTotals;
}): Omit<MarketplaceLossCostsInput, 'purchaseCost'> | undefined {
    if (!row.expenses) return undefined; // Старый снимок ещё не содержит проверенных финансовых расходов.
    const expenses = validateLossExpenses(row.expenses);
    if (row.soldUnits !== null && (!Number.isSafeInteger(row.soldUnits) || row.soldUnits < 0))
        throw new Error('Некорректное число продаж для расходов');
    const perSale = (value: number | null) => (row.soldUnits > 0 && value !== null ? value / row.soldUnits : null);
    return {
        defectRate: row.defectRate,
        ...(expenses.paidReturnDelivery === undefined
            ? {}
            : { paidReturnDelivery: perSale(expenses.paidReturnDelivery) }),
        cancellationDelivery: perSale(expenses.cancellationDelivery),
        sellerReturnDelivery: perSale(expenses.sellerReturnDelivery),
        // При отсутствии продаж цена всё равно не вычисляется: остальные входы останутся NULL.
        confirmedDefectCompensation: perSale(expenses.confirmedDefectCompensation) ?? 0,
    };
}
