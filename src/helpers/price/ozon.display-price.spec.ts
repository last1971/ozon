import { ozonDisplayPrice } from './ozon.display-price';
describe('Зачёркнутая цена Ozon', () => {
    it.each([
        [399, 399, 420],
        [400, 400, 422],
        [950, 1000, 1001],
        [10000, 10000, 10527],
        [10001, 10001, 10502],
        [1000, 1200, 1200],
        [1000, 0, 0],
        [100, 1000, 0],
    ])('%s / %s → %s, без изменения цены продажи', (price, old, expected) => {
        expect(ozonDisplayPrice(price, old)).toBe(expected);
        expect(ozonDisplayPrice(price, expected)).toBe(expected);
    });
    it.each([NaN, Infinity, -1, 0])('не пропускает некорректную цену %s', (price) => {
        expect(() => ozonDisplayPrice(price, 100)).toThrow();
    });
});
