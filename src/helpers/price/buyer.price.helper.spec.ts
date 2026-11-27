import { buyerPrice, ozonActionFloor } from './buyer.price.helper';

describe('buyer price helper — наложение акций Ozon и нашей', () => {
    describe('buyerPrice', () => {
        it.each([
            [310, 294], [1810, 1719], [890, 845], [1010, 959], [230, 218], [1325, 1259],
        ])('при скидке 5%% цена акции %i даёт подтверждённые Ozon %i ₽', (base, actual) => {
            expect(buyerPrice(base, [], 5)).toBe(actual);
        });
        it('383367 живьём: price 255, эластичный бустинг 226, наш 5 % → 215', () => {
            expect(buyerPrice(255, [226], 5)).toBe(215);
        });
        it('6 % → 212, уже ниже min_price 213 — Ozon дно не держит', () => {
            expect(buyerPrice(255, [226], 6)).toBe(212);
        });
        it('без Ozon-акций — процент от price (509819-10: 14224 × 0.79 = 11237)', () => {
            expect(buyerPrice(14224, [], 21)).toBe(11237);
        });
        it('несколько Ozon-акций — берётся самая низкая', () => {
            expect(buyerPrice(2023, [1638, 1554], 5)).toBe(1476);
        });
        it('нулевые цены акций игнорируются; процент 0 → min(price, акции)', () => {
            expect(buyerPrice(255, [0, 226], 0)).toBe(226);
        });
    });

    describe('ozonActionFloor', () => {
        it('без процента — само дно', () => expect(ozonActionFloor(213, 0)).toBe(213));
        it('5 % → ceil(213 / 0.95) = 225', () => expect(ozonActionFloor(213, 5)).toBe(225));
        it('пол держит дно: floor × (1 − p) ≥ min_price', () => {
            for (const [mn, p] of [
                [213, 5],
                [1452, 7],
                [11254, 21],
                [79857, 33],
            ]) {
                expect(buyerPrice(1e9, [ozonActionFloor(mn, p)], p)).toBeGreaterThanOrEqual(mn);
            }
        });
        it('100 % — ошибка, не деление на ноль', () => expect(() => ozonActionFloor(100, 100)).toThrow());
    });
});
