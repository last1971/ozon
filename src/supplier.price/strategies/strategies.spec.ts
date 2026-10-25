import { CbrPlusPercentCurrency } from './cbr.plus.percent.currency';
import { RubAsIsCurrency } from './rub.as.is.currency';
import { CompelDeliveryCost } from './compel.delivery.cost';

describe('кирпич валюты', () => {
    const rates = { USD: 80.54, CNY: 12.06 };

    it('ЦБ + 2%: доллары → рубли с надбавкой на курс', () => {
        const c = new CbrPlusPercentCurrency(2);
        expect(c.toRub(1, 'USD', rates)).toBeCloseTo(82.1508, 4);
        expect(c.toRub(0.0186, 'usd', rates)).toBeCloseTo(0.0186 * 80.54 * 1.02, 6);
    });

    it('ЦБ + 2%: рубли проходят как есть, без надбавки', () => {
        expect(new CbrPlusPercentCurrency(2).toRub(10, 'RUB', rates)).toBe(10);
    });

    it('ЦБ + 2%: нет курса — ошибка, а не 0', () => {
        expect(() => new CbrPlusPercentCurrency(2).toRub(1, 'EUR', rates)).toThrow('нет курса ЦБ для EUR');
        expect(() => new CbrPlusPercentCurrency(2).toRub(1, 'USD', {})).toThrow('нет курса ЦБ для USD');
    });

    it('рубли как есть: чужая валюта — ошибка', () => {
        expect(new RubAsIsCurrency().toRub(5, 'RUB')).toBe(5);
        expect(() => new RubAsIsCurrency().toRub(5, 'USD')).toThrow('пришла валюта USD');
    });
});

describe('кирпич доставки Компэла', () => {
    it('пока 0 при любой цене', () => {
        const d = new CompelDeliveryCost();
        expect(d.costRub(1.5, 'X')).toBe(0);
        expect(d.costRub(10000, 'Y')).toBe(0);
    });
});
