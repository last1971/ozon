/** Суммы финансовых расходов в копейках; не округляем повреждённый ввод. */
export function lossMoneyCents(value: number): number {
    const result = Math.round(value * 100);
    if (!Number.isSafeInteger(result) || Math.abs(result / 100 - value) > 1e-7)
        throw new Error('Некорректная денежная точность расходов');
    return result;
}
