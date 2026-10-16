import { MarkScanPool } from './mark-scan.pool';

const KI = (n: number) => `0104650194492385215gpBxjCjAX${String(n).padStart(3, '0')}`;
const code = (n: number, quantity = 1) => ({
    ki: KI(n),
    quantity,
    status: 5,
    transferType: 3,
    retireReason: null,
    chzSent: false,
});

describe('MarkScanPool — марки кнопки на несколько возвратов', () => {
    it('25 возвратов по 1 шт с одной строки: каждый забирает свою марку, лишних нет', () => {
        const codes = Array.from({ length: 25 }, (_, i) => code(i));
        const pool = new MarkScanPool(codes.map((c) => c.ki));
        const taken = codes.map(() => pool.take(codes, 1));
        expect(new Set(taken.flat()).size).toBe(25);
        expect(() => pool.assertAllUsed()).not.toThrow();
    });

    it('возвраты с разных строк берут только свои коды', () => {
        const pool = new MarkScanPool([KI(2), KI(1)]);
        expect(pool.take([code(1)], 1)).toEqual([KI(1)]);
        expect(pool.take([code(2)], 1)).toEqual([KI(2)]);
        expect(() => pool.assertAllUsed()).not.toThrow();
    });

    it('марок не хватило последнему возврату — отказ', () => {
        const codes = [code(1), code(2)];
        const pool = new MarkScanPool([KI(1)]);
        pool.take(codes, 1);
        expect(() => pool.take(codes, 1)).toThrow('марок на 0 шт, вернулось 1');
    });

    it('лишняя своя марка и чужая — разные отказы', () => {
        const own = new MarkScanPool([KI(1), KI(2)]);
        own.take([code(1), code(2)], 1);
        expect(() => own.assertAllUsed()).toThrow('Лишние марки');
        const foreign = new MarkScanPool([KI(1), KI(9)]);
        foreign.take([code(1)], 1);
        expect(() => foreign.assertAllUsed()).toThrow('не с этой строки');
    });

    it('марки не спрашивали (проблема) — сканы не проверяются', () => {
        expect(() => new MarkScanPool([KI(1)]).assertAllUsed()).not.toThrow();
    });
});
