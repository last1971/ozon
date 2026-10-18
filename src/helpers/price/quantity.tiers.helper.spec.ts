import {
    buildTiers,
    DEFAULT_TIER_THRESHOLDS,
    defaultThresholds,
    parseTierDefaults,
    pickThresholds,
} from './quantity.tiers.helper';

describe('quantity tiers helper', () => {
    const table = parseTierDefaults(DEFAULT_TIER_THRESHOLDS);

    describe('parseTierDefaults', () => {
        it('разбирает умолчания', () => {
            expect(table).toEqual([
                { below: 50, mopt: 10, opt: 100 },
                { below: 200, mopt: 5, opt: 20 },
                { below: 1000, mopt: 3, opt: 10 },
                { below: null, mopt: 2, opt: 5 },
            ]);
        });
        it('отвергает кривые строки', () => {
            expect(() => parseTierDefaults('50:10/100')).toThrow(); // нет строки «дальше»
            expect(() => parseTierDefaults('50:100/10,2/5')).toThrow(); // мелкий ≥ опт
            expect(() => parseTierDefaults('50:1/5,2/5')).toThrow(); // порог 1
            expect(() => parseTierDefaults('200:5/20,50:10/100,2/5')).toThrow(); // границы не по возрастанию
        });
    });

    describe('defaultThresholds — границы', () => {
        it.each([
            [49.99, 10, 100],
            [50, 5, 20],
            [199.99, 5, 20],
            [200, 3, 10],
            [999.99, 3, 10],
            [1000, 2, 5],
            [50000, 2, 5],
        ])('цена %p → %p/%p', (price, mopt, opt) => {
            expect(defaultThresholds(price, table)).toEqual({ mopt, opt });
        });
    });

    describe('pickThresholds', () => {
        it('пара из Trade, если 1 < мелкий < опт', () => {
            expect(pickThresholds({ mopt: 20, opt: 100 }, 30, table)).toEqual([20, 100]);
        });
        it.each([
            [{ mopt: 1, opt: 10 }],
            [{ mopt: 20, opt: 5 }],
            [{ mopt: 10, opt: 10 }],
            [{ mopt: 0, opt: 0 }],
            [{ mopt: null, opt: null }],
            [undefined],
        ])('мусор из Trade %p → умолчание по цене', (trade) => {
            expect(pickThresholds(trade as any, 30, table)).toEqual([10, 100]);
        });
    });

    describe('buildTiers — проверенные цифры владельца (УСН 11 %, реальный код на .25)', () => {
        it('себест. 1 ₽: 1 шт 55; 10 шт 65/45 → 5,50; 100 шт 207/171 → 1,71', () => {
            const { tiers, dropped } = buildTiers(5500, [
                { quantity: 10, price: 65, min_price: 45 },
                { quantity: 100, price: 207, min_price: 171 },
            ]);
            expect(tiers).toEqual([
                { quantity: 10, price: 550 },
                { quantity: 100, price: 171 },
            ]);
            expect(dropped).toEqual([]);
        });
        it('себест. 10 ₽: 65; 10 шт 207/171 → 18,90; 100 шт 1495/1315 → 13,15', () => {
            const { tiers } = buildTiers(6500, [
                { quantity: 100, price: 1495, min_price: 1315 },
                { quantity: 10, price: 207, min_price: 171 }, // порядок на входе не важен
            ]);
            expect(tiers).toEqual([
                { quantity: 10, price: 1890 },
                { quantity: 100, price: 1315 },
            ]);
        });
        it('одна ступень — минимальная цена партии: себест. 100 ₽, 10 шт 1495/1315 → 131,50', () => {
            expect(buildTiers(20700, [{ quantity: 10, price: 1495, min_price: 1315 }]).tiers).toEqual([
                { quantity: 10, price: 13150 },
            ]);
        });
        it('округление до копейки', () => {
            expect(buildTiers(10000, [{ quantity: 3, price: 100, min_price: 100 }]).tiers).toEqual([
                { quantity: 3, price: 3333 },
            ]);
        });
    });

    describe('buildTiers — страж (Sylius отвергает набор целиком)', () => {
        it('ступень дороже обычной цены выбрасывается, следующая сравнивается с обычной', () => {
            const { tiers, dropped } = buildTiers(5000, [
                { quantity: 2, price: 120, min_price: 110 }, // 57,50 > 50
                { quantity: 5, price: 200, min_price: 150 }, // 30 ≤ 50
            ]);
            expect(tiers).toEqual([{ quantity: 5, price: 3000 }]);
            expect(dropped).toHaveLength(1);
            expect(dropped[0]).toMatchObject({ quantity: 2, price: 5750 });
        });
        it('равенство допускается, как в Sylius', () => {
            expect(buildTiers(5000, [{ quantity: 2, price: 100, min_price: 100 }]).tiers).toEqual([
                { quantity: 2, price: 5000 },
            ]);
        });
        it('ступень дороже предыдущей оставленной выбрасывается', () => {
            const { tiers } = buildTiers(10000, [
                { quantity: 2, price: 100, min_price: 80 }, // mid 90 → 45
                { quantity: 5, price: 300, min_price: 250 }, // 50 > 45
            ]);
            expect(tiers).toEqual([{ quantity: 2, price: 4500 }]);
        });
        it('нечисловое и неположительное не уходит', () => {
            const { tiers, dropped } = buildTiers(5000, [
                { quantity: 2, price: NaN, min_price: NaN },
                { quantity: 1, price: 10, min_price: 10 },
                { quantity: 2.5, price: 10, min_price: 10 },
            ]);
            expect(tiers).toEqual([]);
            expect(dropped).toHaveLength(3);
        });
        it('без обычной цены ступеней нет', () => {
            expect(buildTiers(NaN, [{ quantity: 2, price: 10, min_price: 10 }]).tiers).toEqual([]);
            expect(buildTiers(0, [{ quantity: 2, price: 10, min_price: 10 }]).tiers).toEqual([]);
        });
    });
});
