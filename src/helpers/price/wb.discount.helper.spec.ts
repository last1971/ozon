import { wbDiscountTo } from './wb.discount.helper';

describe('wbDiscountTo — скидка ВБ до цели', () => {
    it('floor: 100 → не ниже 94.5 — 5 % (95), а не 6 % (94)', () => expect(wbDiscountTo(100, 94.5)).toBe(5));
    it('526388 живьём 22.10: база 1811, мин 1243 → 31 % (1250)', () => expect(wbDiscountTo(1811, 1243)).toBe(31));
    it('цель выше базы — скидки нет', () => expect(wbDiscountTo(100, 120)).toBe(0));
});
