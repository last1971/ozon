import { resolvePriceBase } from './price.base';

describe('База цены своей фасовки', () => {
    const good = {
        code: 501328,
        name: 'Товар',
        price: 23.56,
        base_source: 'remaining-lots' as const,
        free_stock: 1000,
    };
    it.each([
        [1, 23],
        [5, 115],
        [10, 230],
        [100, 2300],
    ])('501328: фасовка %s, цена пачки %s не умножается повторно', (pieces, market) => {
        expect(
            resolvePriceBase(`501328-${pieces}`, pieces, good, { offer_id: '501328', pieces, available_price: market }),
        ).toMatchObject({ incoming_price: market, available_price: market, base_source: 'market' });
    });
    it('не берёт рыночную цену чужой фасовки', () => {
        expect(
            resolvePriceBase('501328-5', 5, good, { offer_id: '501328', pieces: 100, available_price: 2300 }),
        ).toMatchObject({ incoming_price: 23.56 * 5, available_price: 0, base_source: 'remaining-lots' });
    });
    it('не берёт рыночную цену другого товара', () => {
        expect(
            resolvePriceBase('501328-5', 5, good, { offer_id: '380137', pieces: 5, available_price: 19000 })
                .incoming_price,
        ).toBe(23.56 * 5);
    });
    it('380137-1000: 19000 за пачку остаётся 19000, а не 19 миллионов', () => {
        expect(
            resolvePriceBase(
                '380137-1000',
                1000,
                { ...good, code: 380137, price: 25.98 },
                { offer_id: '380137', pieces: 1000, available_price: 19000 },
            ).incoming_price,
        ).toBe(19000);
    });
    it('без своей рыночной цены умножает закупку за штуку ровно один раз', () => {
        expect(resolvePriceBase('501328-5', 5, good).incoming_price).toBe(117.8);
    });
    it('рыночная цена своей фасовки даёт базу даже без партий и приходов', () => {
        expect(
            resolvePriceBase(
                '501328-5',
                5,
                { ...good, price: null, base_source: 'none' },
                { offer_id: '501328', pieces: 5, available_price: 115 },
            ),
        ).toEqual({ incoming_price: 115, available_price: 115, base_source: 'market' });
    });
    it.each([0, -1, NaN, Infinity])('не использует неположительную/нечисловую рыночную цену %s', (market) => {
        expect(
            resolvePriceBase('501328-5', 5, good, { offer_id: '501328', pieces: 5, available_price: market })
                .incoming_price,
        ).toBe(117.8);
    });
    it('без закупки и своей рыночной цены не допускает подстановку обходом', () => {
        expect(
            resolvePriceBase('501328-5', 5, { ...good, price: null, base_source: 'none' }, undefined, 100),
        ).toMatchObject({ incoming_price: null, base_source: 'none', skipReason: 'no-base' });
    });
    it('без свободного остатка не считает даже с рыночной ценой', () => {
        expect(
            resolvePriceBase(
                '501328-5',
                5,
                { ...good, free_stock: 0 },
                { offer_id: '501328', pieces: 5, available_price: 115 },
            ),
        ).toMatchObject({ incoming_price: null, skipReason: 'no-free-stock' });
    });
    it('рыночная цена не заменяется подстановкой закупки', () => {
        expect(
            resolvePriceBase('501328-5', 5, good, { offer_id: '501328', pieces: 5, available_price: 115 }, 999)
                .incoming_price,
        ).toBe(115);
    });
});
