import { CbrPlusPercentCurrency } from './cbr.plus.percent.currency';
import { RubAsIsCurrency } from './rub.as.is.currency';
import { CompelDeliveryCost } from './compel.delivery.cost';
import { CompelMarkup } from './compel.markup';
import { RuelectronicsMarkup } from './ruelectronics.markup';
import { RuelectronicsDeliveryCost } from './ruelectronics.delivery.cost';
import { ConfigService } from '@nestjs/config';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../../sylius.price/sylius.price.service';

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

describe('кирпич наценки Компэла', () => {
    // Сайт как на проде: налог 11 %, этикетки и упаковки нет
    const sylius = {
        getObtainCoeffs: () => ({
            minMil: 0,
            percMil: 0,
            percEkv: 0,
            sumObtain: 0,
            sumLabel: 0,
            sumPack: 0,
            taxUnit: 11,
        }),
    } as unknown as SyliusPriceService;
    const helper = { getDefaultPercents: () => ({ packing_price: 16 }) } as unknown as PriceCalculationHelper;
    const markup = (env: Record<string, unknown> = {}) =>
        new CompelMarkup(helper, sylius, { get: (key: string, def?: unknown) => env[key] ?? def } as ConfigService);

    it('MS1242 (закупка 329,42 ₽): зачёркнутая +15 %, обычная +8 %, минимальная +4 %', () => {
        expect(markup().apply('MS1242', 329.42)).toEqual({
            old_price: 426, // ceil(329,42 × 1,15 / 0,89)
            price: 400, // ceil(329,42 × 1,08 / 0,89)
            min_price: 385, // ceil(329,42 × 1,04 / 0,89)
            old_perc: 15,
            perc: 8,
            min_perc: 4,
        });
    });

    it('дешёвая деталь (0,27 ₽): все три цены — страховка 10 ₽, ceil(10,27 / 0,89) = 12', () => {
        const r = markup().apply('CHEAP', 0.27);
        expect([r.min_price, r.price, r.old_price]).toEqual([12, 12, 12]);
    });

    it('цифры из настроек: COMPEL_MARKUP_PERC 10, страховка 0 — цена ровно по проценту', () => {
        const r = markup({ COMPEL_MARKUP_PERC: '10', COMPEL_MIN_PROFIT_RUB: '0' }).apply('X', 0.27);
        expect(r.price).toBe(1); // ceil(0,27 × 1,1 / 0,89)
        expect(r.perc).toBe(10);
    });

    it('кривые настройки — ошибка при старте, не молча', () => {
        expect(() => markup({ COMPEL_MIN_PERC: '9' })).toThrow('минимальная ≤ обычная ≤ зачёркнутая');
        expect(() => markup({ COMPEL_MARKUP_PERC: 'abc' })).toThrow('должны быть числами');
    });

    it('ruelectronics — те же 15/8/4 от VIP-цены, но свои настройки: цифры Компэла его не трогают', () => {
        const ruel = (env: Record<string, unknown> = {}) =>
            new RuelectronicsMarkup(helper, sylius, {
                get: (key: string, def?: unknown) => env[key] ?? def,
            } as ConfigService);
        // CBB61 2 мкФ 450 В, VIP 28,61 ₽ — те же цены, что дал бы Компэл
        expect(ruel().apply('100018', 28.61)).toEqual(markup().apply('100018', 28.61));
        expect(ruel({ COMPEL_MARKUP_PERC: '20' }).apply('X', 329.42).price).toBe(400);
        expect(ruel({ RUELECTRONICS_MARKUP_PERC: '10' }).apply('X', 329.42).price).toBe(408); // ceil(329,42 × 1,1 / 0,89)
        expect(() => ruel({ RUELECTRONICS_MIN_PERC: '9' })).toThrow('Наценка ruelectronics');
    });
});

describe('кирпич доставки ruelectronics', () => {
    it('пока 0', () => {
        expect(new RuelectronicsDeliveryCost().costRub(28.61, '100018')).toBe(0);
    });
});
