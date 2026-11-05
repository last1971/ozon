import { calculateOzonReturnPerc } from './ozon.return.perc';

describe('Доля оплаченных возвратов Ozon', () => {
    it('пример владельца: продано 3, отменено 3, оплачено 3 возврата — 100%', () => {
        const counts = { soldUnits: 3, cancelledUnits: 3, paidReturnUnits: 3 };
        expect(calculateOzonReturnPerc(counts)).toBe(1);
    });

    it.each([0, 3, 10])('число отмен %s не уменьшает продажи и не увеличивает возвраты', (cancelledUnits) => {
        const counts = { soldUnits: 10, cancelledUnits, paidReturnUnits: 2 };
        expect(calculateOzonReturnPerc(counts)).toBe(0.2);
    });

    it('при продажах без возвратов возвращает 0, даже если fallback ненулевой', () => {
        expect(calculateOzonReturnPerc({ soldUnits: 3, paidReturnUnits: 0 }, 0.1)).toBe(0);
    });

    it('сохраняет точность доли до записи в БД', () => {
        expect(calculateOzonReturnPerc({ soldUnits: 3, paidReturnUnits: 1 })).toBeCloseTo(1 / 3, 12);
    });

    it.each([0, 3])('без продаж и при %s возвратах возвращает 0 без деления на ноль', (paidReturnUnits) => {
        expect(calculateOzonReturnPerc({ soldUnits: 0, paidReturnUnits })).toBe(0);
    });

    it('без продаж использует явно переданную резервную долю', () => {
        expect(calculateOzonReturnPerc({ soldUnits: 0, paidReturnUnits: 3 }, 0.05)).toBe(0.05);
    });

    it('не подменяет фактическое отношение ограничением в 100%', () => {
        expect(calculateOzonReturnPerc({ soldUnits: 2, paidReturnUnits: 3 })).toBe(1.5);
    });

    it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('отклоняет некорректное количество %s', (value) => {
        expect(() => calculateOzonReturnPerc({ soldUnits: value, paidReturnUnits: 0 })).toThrow(RangeError);
        expect(() => calculateOzonReturnPerc({ soldUnits: 1, paidReturnUnits: value })).toThrow(RangeError);
    });

    it.each([-0.01, 1.01, NaN, Infinity])('отклоняет некорректную резервную долю %s', (fallbackPerc) => {
        expect(() => calculateOzonReturnPerc({ soldUnits: 0, paidReturnUnits: 0 }, fallbackPerc)).toThrow(RangeError);
    });
});
