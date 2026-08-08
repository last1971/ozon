import {
    codesAfterOrders,
    distributeCodesToSkus,
    dropCodesForNeed,
    sumNominals,
} from './mark-codes.distribution';

const codes = (...pairs: [number, number][]) => new Map<number, number>(pairs);

describe('mark-codes.distribution', () => {
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

    describe('codesAfterOrders', () => {
        it('552601 с прода: заказы 1, 3, 3 забирают код на 1 и два по 3, коробки на 12 целы', () => {
            const free = codes([1, 2], [3, 9], [6, 4], [12, 2], [40, 32]);

            const left = codesAfterOrders(free, [1, 3, 3]);

            expect(left).toEqual(codes([1, 1], [3, 7], [6, 4], [12, 2], [40, 32]));
            expect(sumNominals(left)).toBe(1350); // 1357 − 7, ровно по заказам
        });

        it('тот же резерв одной суммой съел бы код на 12 — считаем именно по заказам', () => {
            const free = codes([1, 2], [3, 9], [6, 4], [12, 2], [40, 32]);

            // если бы закрывали 7 одной кучей: минимальная сумма ≥ 7 — это 1 + 6
            expect(dropCodesForNeed(free, 7)).toEqual(codes([1, 1], [3, 9], [6, 3], [12, 2], [40, 32]));
            // по заказам уходят другие коды — те же 7 штук, но из фасовки -3
            expect(codesAfterOrders(free, [1, 3, 3])).toEqual(codes([1, 1], [3, 7], [6, 4], [12, 2], [40, 32]));
        });

        it('заказов нет — всё остаётся', () => {
            const free = codes([1, 16], [100, 12], [800, 9]);
            expect(codesAfterOrders(free, [])).toEqual(free);
        });

        it('498824: заказ на 24 штуки при 16 единичных — уходит код на 100', () => {
            const free = codes([1, 16], [100, 12], [800, 9]);

            const left = codesAfterOrders(free, [24]);

            expect(left).toEqual(codes([1, 16], [100, 11], [800, 9]));
        });

        it('крупные заказы обрабатываются первыми', () => {
            // заказы 5 и 1: пятёрка берёт код на 5, единица — штучный
            const left = codesAfterOrders(codes([1, 1], [5, 1], [6, 1]), [1, 5]);

            expect(left).toEqual(codes([6, 1]));
        });

        it('кодов не хватает на заказы — товар уходит в 0', () => {
            expect(codesAfterOrders(codes([10, 2]), [25])).toEqual(new Map());
        });

        it('нулевые строки резерва игнорируются', () => {
            const free = codes([3, 2]);
            expect(codesAfterOrders(free, [0, 0])).toEqual(free);
        });
    });

    describe('distributeCodesToSkus', () => {
        it('номинал со своей фасовкой получает число кодов, а не штук', () => {
            const result = distributeCodesToSkus('498824', ['498824', '498824-100'], codes([100, 12]));

            expect(result).toEqual(new Map([['498824', 0], ['498824-100', 12]]));
        });

        it('единичные коды идут в базовую фасовку штуками', () => {
            const result = distributeCodesToSkus('498824', ['498824', '498824-100'], codes([1, 16], [100, 12]));

            expect(result).toEqual(new Map([['498824', 16], ['498824-100', 12]]));
        });

        it('498824: номинал 800 без своей фасовки → 7200 штук в базовую', () => {
            const skus = ['498824', '498824-5', '498824-10', '498824-100', '498824-1000'];

            const result = distributeCodesToSkus('498824', skus, codes([1, 16], [100, 11], [800, 9]));

            expect(result).toEqual(
                new Map([
                    ['498824', 7216], // 16 единичных + 9 × 800
                    ['498824-5', 0],
                    ['498824-10', 0],
                    ['498824-100', 11],
                    ['498824-1000', 0],
                ]),
            );
        });

        it('заведена фасовка 800 — коды уезжают в неё, базовая остаётся с единичными', () => {
            const skus = ['498824', '498824-100', '498824-800'];

            const result = distributeCodesToSkus('498824', skus, codes([1, 16], [100, 11], [800, 9]));

            expect(result).toEqual(
                new Map([['498824', 16], ['498824-100', 11], ['498824-800', 9]]),
            );
        });

        it('базовая фасовка может быть заведена как код-1', () => {
            const result = distributeCodesToSkus('552601', ['552601-1', '552601-3'], codes([1, 2], [3, 9], [40, 32]));

            // 2 единичных + 32 × 40 штук из номинала без фасовки
            expect(result).toEqual(new Map([['552601-1', 1282], ['552601-3', 9]]));
        });

        it('если заведены и код, и код-1 — одинаковое значение в обе, без деления пополам', () => {
            const result = distributeCodesToSkus('552601', ['552601', '552601-1'], codes([1, 5]));

            expect(result).toEqual(new Map([['552601', 5], ['552601-1', 5]]));
        });

        it('фасовки без кодов обнуляются, старое значение не наследуется', () => {
            const result = distributeCodesToSkus('569126', ['569126', '569126-10', '569126-20'], new Map());

            expect(result).toEqual(new Map([['569126', 0], ['569126-10', 0], ['569126-20', 0]]));
        });

        it('базовой фасовки нет — штуки без своего номинала теряются', () => {
            const result = distributeCodesToSkus('569126', ['569126-10'], codes([1, 4], [10, 2]));

            expect(result).toEqual(new Map([['569126-10', 2]]));
        });
    });
});
