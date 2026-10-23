import { buyerPrice, ozonActionFloor, ozonPriceActions } from './buyer.price.helper';

describe('buyer price helper — наложение акций Ozon и нашей', () => {
    describe('buyerPrice', () => {
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

    describe('ozonPriceActions', () => {
        const actions = [
            { title: 'Эластичный бустинг. Без ограничения срока действия', value: 2739, date_from: '', date_to: '' },
            { title: 'РК. Рассрочка 0-0-4', value: 4, date_from: '', date_to: '' },
            { title: 'АБ тест 24 к', value: 24, date_from: '', date_to: '' },
            { title: '26-10', value: 5, date_from: '', date_to: '' },
            { title: 'Максимальный бустинг', value: 2800, date_from: '', date_to: '' },
        ];
        it('остаются только акции с ценой; наша и рассрочки/АБ отсекаются', () => {
            expect(ozonPriceActions(actions, 2596, '26-10').map((a) => a.value)).toEqual([2739, 2800]);
        });
        it('без названия нашей акции отсекает её по порогу «треть min_price»', () => {
            expect(ozonPriceActions(actions, 2596).map((a) => a.value)).toEqual([2739, 2800]);
        });
        it('undefined → пусто', () => expect(ozonPriceActions(undefined, 100)).toEqual([]));
        it('акция, которая ещё не началась или уже кончилась, цену сейчас не задаёт (513498: Супербустинг 30.10)', () => {
            const dated = [
                { title: 'Супербустинг', value: 1598, date_from: '2026-10-29T21:00:00Z', date_to: '2026-10-30T21:00:59Z' },
                { title: 'Прошлая', value: 1500, date_from: '2026-10-01T00:00:00Z', date_to: '2026-10-10T00:00:00Z' },
                { title: 'Идёт', value: 1700, date_from: '2026-10-20T00:00:00Z', date_to: '2026-11-10T00:00:00Z' },
            ];
            const now = new Date('2026-10-23T09:00:00Z');
            expect(ozonPriceActions(dated, 1518, undefined, now).map((a) => a.title)).toEqual(['Идёт']);
        });
    });
});
