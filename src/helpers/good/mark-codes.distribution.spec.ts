import {
    computeNeedToDrop,
    dropCodesForNeed,
    freeCodesAfterReserve,
    sumNominals,
} from './mark-codes.distribution';

const codes = (...pairs: [number, number][]) => new Map<number, number>(pairs);

describe('mark-codes.distribution', () => {
    describe('computeNeedToDrop', () => {
        it('коды сходятся с остатком — закрываем ровно резерв', () => {
            // Пример заказчика: остаток 100, резерв 24, коды 40/30/20/10
            expect(computeNeedToDrop(codes([40, 1], [30, 1], [20, 1], [10, 1]), 100, 24)).toBe(24);
        });

        it('резерва нет — отбрасывать нечего', () => {
            expect(computeNeedToDrop(codes([100, 12]), 1200, 0)).toBe(0);
        });

        it('кодов больше учётного остатка — добавляем разницу (552601 на проде)', () => {
            // свободных кодов на 1357 шт при остатке 1352 и резерве 1
            expect(computeNeedToDrop(codes([1, 2], [3, 9], [6, 4], [12, 2], [40, 32]), 1352, 1)).toBe(6);
        });

        it('кодов меньше остатка — резерв не гасится разницей', () => {
            // 76 штук кодами при остатке 90 и резерве 10: закрыть надо именно резерв
            expect(computeNeedToDrop(codes([76, 1]), 90, 10)).toBe(10);
        });

        it('reserve не задан — ноль', () => {
            expect(computeNeedToDrop(codes([10, 1]), 10, undefined)).toBe(0);
        });
    });

    describe('dropCodesForNeed', () => {
        it('пример заказчика: 40/30/20/10 при need 24 → уходит 30', () => {
            const left = dropCodesForNeed(codes([40, 1], [30, 1], [20, 1], [10, 1]), 24);
            expect(left).toEqual(codes([10, 1], [20, 1], [40, 1]));
        });

        it('need 0 — не отбрасываем ничего', () => {
            const free = codes([1, 16], [100, 12], [800, 9]);
            expect(dropCodesForNeed(free, 0)).toEqual(free);
        });

        it('равная сумма — берём вариант с меньшим числом кодов', () => {
            // need 24: 30 (один код) против 20+10 (два кода) — сумма одинаковая
            const left = dropCodesForNeed(codes([30, 1], [20, 1], [10, 1]), 24);
            expect(left).toEqual(codes([10, 1], [20, 1]));
        });

        it('набирает несколько кодов, если так сумма меньше', () => {
            // need 9: 5+5=10 выгоднее одного кода на 50
            const left = dropCodesForNeed(codes([5, 2], [50, 1]), 9);
            expect(left).toEqual(codes([50, 1]));
        });

        it('единичных кодов не хватает — уходит крупный (447327 на проде)', () => {
            // коды 1×10, 81×1, 100×8, резерв 11 → минимальная сумма ≥ 11 это 81
            const left = dropCodesForNeed(codes([1, 10], [81, 1], [100, 8]), 11);
            expect(left).toEqual(codes([1, 10], [100, 8]));
        });

        it('497132 на проде: резерв 8 снимает код на 20', () => {
            const left = dropCodesForNeed(codes([1, 7], [20, 1], [50, 16]), 8);
            expect(left).toEqual(codes([1, 7], [50, 16]));
        });

        it('единичных кодов хватает — крупные не трогаем', () => {
            const left = dropCodesForNeed(codes([1, 10], [81, 1], [100, 8]), 7);
            expect(left).toEqual(codes([1, 3], [81, 1], [100, 8]));
        });

        it('кодов не хватает на need — отбрасываем все', () => {
            expect(dropCodesForNeed(codes([1, 3], [10, 1]), 100)).toEqual(new Map());
        });

        it('лимит по числу кодов номинала соблюдается', () => {
            // need 25 при двух кодах по 10: 10+10=20 мало, значит берём 10+10+10 нельзя — уходит 30
            const left = dropCodesForNeed(codes([10, 2], [30, 1]), 25);
            expect(left).toEqual(codes([10, 2]));
        });

        it('пустой набор кодов', () => {
            expect(dropCodesForNeed(new Map(), 5)).toEqual(new Map());
            expect(dropCodesForNeed(new Map(), 0)).toEqual(new Map());
        });
    });

    describe('freeCodesAfterReserve', () => {
        it('498824: остаток 8416, резерв 24 → уходит один код на 100', () => {
            const free = codes([1, 16], [100, 12], [800, 9]);

            const left = freeCodesAfterReserve(free, 8416, 24);

            // единичных 16 штук на 24 не хватает, минимальная сумма ≥ 24 — это 100
            expect(left).toEqual(codes([1, 16], [100, 11], [800, 9]));
            expect(sumNominals(left)).toBe(8316);
        });

        it('552601: кодов на 1357 при остатке 1352 и резерве 1 → закрываем 6 штук', () => {
            const free = codes([1, 2], [3, 9], [6, 4], [12, 2], [40, 32]);

            const left = freeCodesAfterReserve(free, 1352, 1);

            // минимальная сумма ≥ 6 — это код на 6
            expect(left).toEqual(codes([1, 2], [3, 9], [6, 3], [12, 2], [40, 32]));
            expect(sumNominals(left)).toBe(1351);
        });

        it('резерва нет и коды сходятся — всё остаётся', () => {
            const free = codes([1, 16], [100, 12], [800, 9]);
            expect(freeCodesAfterReserve(free, 8416, 0)).toEqual(free);
        });

        it('резерв больше всех кодов — товар уходит в 0', () => {
            expect(freeCodesAfterReserve(codes([10, 2]), 20, 25)).toEqual(new Map());
        });
    });
});
