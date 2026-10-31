import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupplierPriceService } from './supplier.price.service';
import { SupplierPriceStrategyRegistry } from './supplier.price.strategy.registry';
import { CompelMarkup } from './strategies/compel.markup';
import { RuelectronicsMarkup } from './strategies/ruelectronics.markup';
import { UnisvsMarkup } from './strategies/unisvs.markup';
import { PromelecMarkup } from './strategies/promelec.markup';
import { ValidateBatchCommand } from './commands/validate-batch.command';
import { ConvertCurrencyCommand } from './commands/convert-currency.command';
import { AddDeliveryCommand } from './commands/add-delivery.command';
import { ApplyMarkupCommand } from './commands/apply-markup.command';
import { BuildResponseCommand } from './commands/build-response.command';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../sylius.price/sylius.price.service';
import { calculatePay } from '../helpers';

/** Коэффициенты сайта как на проде по умолчанию: налог 6 %, этикетка 2, упаковка 10, без эквайринга. */
const config = {
    get: (key: string, def?: any) =>
        ({
            TAX_UNIT: 6,
            SUM_LABEL: 2,
            SUM_PACK: 10,
            MIN_PROFIT_RUB: 20,
            MIN_PROFIT_PERC: 10,
            MIN_PROFIT_TARGET: 103,
            PRICE_SMOOTHING_OFFSET: 500,
        })[key] ?? def,
};
const RATES = { USD: 80.54, CNY: 12.06 };

describe('SupplierPriceService (цепочка цен поставщиков)', () => {
    let service: SupplierPriceService;
    let sylius: SyliusPriceService;
    let helper: PriceCalculationHelper;

    beforeEach(async () => {
        helper = new PriceCalculationHelper(config as unknown as ConfigService);
        sylius = {
            getObtainCoeffs: () => ({ minMil: 0, percMil: 0, percEkv: 0, sumObtain: 0, sumLabel: 2, taxUnit: 6 }),
        } as unknown as SyliusPriceService;
        const module = await Test.createTestingModule({
            providers: [
                SupplierPriceService,
                SupplierPriceStrategyRegistry,
                CompelMarkup,
                RuelectronicsMarkup,
                UnisvsMarkup,
                PromelecMarkup,
                ValidateBatchCommand,
                ConvertCurrencyCommand,
                AddDeliveryCommand,
                ApplyMarkupCommand,
                BuildResponseCommand,
                { provide: PriceCalculationHelper, useValue: helper },
                { provide: SyliusPriceService, useValue: sylius },
                { provide: ConfigService, useValue: config },
            ],
        }).compile();
        service = module.get(SupplierPriceService);
    });

    it('1N4007 у Компэла: $0.0186 → рубли по ЦБ+2%, доставка 0, наценка Компэла 4/8/15 со страховкой 10 ₽', async () => {
        const { prices, errors } = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'compel', code: '1N4007', price: 0.0186, currency: 'USD' }],
        });
        expect(errors).toEqual([]);
        const p = prices[0];
        expect(p.incoming_price).toBeCloseTo(1.53, 2); // 0.0186 × 80.54 × 1.02
        expect(p.delivery).toBe(0);
        expect([p.min_perc, p.perc, p.old_perc]).toEqual([4, 8, 15]);
        // Дешёвая деталь: все три цены упираются в страховку — на минимальной ровно не меньше 10 ₽ прибыли
        const priceable = {
            offer_id: '1N4007',
            incoming_price: p.incoming_price,
            available_price: 0,
            fbs_direct_flow_trans_max_amount: 0,
            sales_percent: 0,
            min_perc: 0,
            perc: 0,
            old_perc: 0,
            adv_perc: 0,
            sum_pack: 10,
        };
        const profit = (sum: number) => calculatePay(priceable, sylius.getObtainCoeffs(), sum).pay - p.incoming_price;
        expect(profit(p.min_price)).toBeGreaterThanOrEqual(10);
        expect(profit(p.min_price - 1)).toBeLessThan(10);
        expect(p.price).toBe(p.min_price);
        expect(p.old_price).toBe(p.min_price);
    });

    it('Promelec: закупка в рублях без конвертации, отдельная наценка 4/8/15 и страховка 10 ₽', async () => {
        const { prices, errors } = await service.calculate({ rates: {}, items: [{ supplier: 'promelec', code: '350979', price: 493.7, currency: 'RUB' }] });
        expect(errors).toEqual([]);
        const p = prices[0];
        expect(p.incoming_price).toBe(493.7);
        expect(p.delivery).toBe(0);
        expect([p.min_perc, p.perc, p.old_perc]).toEqual([4, 8, 15]);
        expect(p.price).toBe(Math.ceil((493.7 * 1.08 + 12) / 0.94));
    });

    it('Uniservice: рубли без конвертации, 20/10/5 % и минимум прибыли 20 ₽', async () => {
        const { prices, errors } = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'unisvs', code: '111884', price: 94.59, currency: 'RUB' }],
        });
        expect(errors).toEqual([]);
        expect(prices).toHaveLength(1);
        const price = prices[0];
        expect(price.incoming_price).toBe(94.59);
        expect(price.delivery).toBe(0);
        expect([price.old_perc, price.perc, price.min_perc]).toEqual([20, 10, 5]);
        expect(price.old_price).toBeGreaterThanOrEqual(price.price);
        expect(price.price).toBeGreaterThanOrEqual(price.min_price);
        const priceable = {
            offer_id: '111884',
            incoming_price: price.incoming_price,
            available_price: 0,
            fbs_direct_flow_trans_max_amount: 0,
            sales_percent: 0,
            min_perc: 0,
            perc: 0,
            old_perc: 0,
            adv_perc: 0,
            sum_pack: 10,
        };
        const pay = calculatePay(priceable, sylius.getObtainCoeffs(), price.min_price);
        expect(pay.pay - price.incoming_price).toBeGreaterThanOrEqual(20);
    });

    it('STM32F103C8T6 у Компэла: $2.9 → цены ровно по процентам 4/8/15, страховка не мешает', async () => {
        const { prices } = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'compel', code: 'STM32F103C8T6', price: 2.9, currency: 'USD' }],
        });
        const stm = prices[0];
        const cost = 2.9 * 80.54 * 1.02; // 238.24
        expect(stm.incoming_price).toBeCloseTo(cost, 2);
        // Налог 6 %, этикетка 2 + упаковка 10 из коэффициентов теста
        expect(stm.min_price).toBe(Math.ceil((cost * 1.04 + 12) / 0.94));
        expect(stm.price).toBe(Math.ceil((cost * 1.08 + 12) / 0.94));
        expect(stm.old_price).toBe(Math.ceil((cost * 1.15 + 12) / 0.94));
    });

    it('ступени поставщика: каждая считается той же наценкой, дорожающие отбрасываются', async () => {
        const { prices } = await service.calculate({
            rates: RATES,
            items: [
                {
                    supplier: 'compel',
                    code: 'RC0603',
                    price: 0.01,
                    currency: 'USD',
                    tiers: [
                        { quantity: 100, price: 0.006 },
                        { quantity: 1000, price: 0.004 },
                        { quantity: 5000, price: 0.02 }, // дороже — выпадет
                    ],
                },
            ],
        });
        const tiers = prices[0].tiers;
        // Закупка 0,82 ₽ — до первой ступени поставщика (100) встаёт своя 10 шт
        expect(tiers.map((t) => t.quantity)).toEqual([10, 100, 1000]);
        expect(tiers[0].price).toBeLessThanOrEqual(prices[0].price);
        expect(tiers[1].price).toBeLessThanOrEqual(tiers[0].price);
        expect(tiers[2].price).toBeLessThanOrEqual(tiers[1].price);
    });

    it('ступени поставщика только от большого количества: свои 10/100/1000 встают перед ними', async () => {
        const { prices, errors } = await service.calculate({
            rates: RATES,
            items: [
                {
                    supplier: 'compel',
                    code: 'CHEAP',
                    price: 0.0033,
                    currency: 'USD',
                    tiers: [
                        { quantity: 7522, price: 0.0031 },
                        { quantity: 12832, price: 0.0029 },
                    ],
                },
            ],
        });
        expect(errors).toEqual([]);
        const p = prices[0];
        expect(p.tiers.map((t) => t.quantity)).toEqual([10, 100, 1000, 7522, 12832]);
        p.tiers.reduce((prev, t) => {
            expect(t.price).toBeLessThanOrEqual(prev);
            return t.price;
        }, p.price);
    });

    it('одна цена у поставщика: ступени свои — закупка до 1 ₽ 10/100/1000, остальным по рознице (200–1000 ₽ → 3/10)', async () => {
        const { prices, errors } = await service.calculate({
            rates: RATES,
            items: [
                // CR-05FL7-3R у Компэла: $0.00085, одна цена — на сайте 32 ₽ за штуку при закупке 0,07 ₽
                { supplier: 'compel', code: 'CR-05FL7-3R', price: 0.00085, currency: 'USD' },
                { supplier: 'compel', code: 'STM32F103C8T6', price: 2.9, currency: 'USD' },
            ],
        });
        expect(errors).toEqual([]);
        const cheap = prices.find((p) => p.code === 'CR-05FL7-3R');
        const stm = prices.find((p) => p.code === 'STM32F103C8T6');
        expect(cheap.incoming_price).toBeLessThan(1);
        expect(cheap.tiers.map((t) => t.quantity)).toEqual([10, 100, 1000]);
        expect(cheap.tiers[0].price).toBeLessThan(cheap.price);
        expect(cheap.tiers[1].price).toBeLessThan(cheap.tiers[0].price);
        expect(cheap.tiers[2].price).toBeLessThan(cheap.tiers[1].price);
        expect(stm.price).toBeGreaterThanOrEqual(200);
        expect(stm.price).toBeLessThan(1000);
        expect(stm.tiers.map((t) => t.quantity)).toEqual([3, 10]);
        expect(stm.tiers[1].price).toBeLessThanOrEqual(stm.tiers[0].price);
        expect(stm.tiers[0].price).toBeLessThanOrEqual(stm.price);
    });

    it('кратность: цена и страховка на пачку, за штуку — как в ступени «от пачки»; свои ступени только больше пачки', async () => {
        // CBB61 2 мкФ у ruelectronics: VIP 28,61 ₽, продаётся по 10 шт
        const single = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'ruelectronics', code: '100018', price: 28.61, currency: 'RUB' }],
        });
        const pack = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'ruelectronics', code: '100018', price: 28.61, currency: 'RUB', multiple: 10 }],
        });
        // та же пачка как одна вещь за 286,10 ₽
        const whole = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'ruelectronics', code: '100018', price: 286.1, currency: 'RUB' }],
        });
        const one = single.prices[0];
        const ten = pack.prices[0];
        expect(pack.errors).toEqual([]);
        expect(ten.price).toBeLessThan(one.price);
        expect(ten.price).toBe(Math.ceil(whole.prices[0].price * 10) / 100);
        expect(ten.min_price).toBeLessThanOrEqual(ten.price);
        expect(ten.old_price).toBeGreaterThanOrEqual(ten.price);
        expect(ten.tiers.map((t) => t.quantity)).toEqual([30, 100]);
        expect(ten.tiers[0].price).toBeLessThan(ten.price);
        expect(ten.tiers[1].price).toBeLessThan(ten.tiers[0].price);
    });

    it('ошибки по строкам, остальные считаются: неизвестный поставщик, нет курса, цена 0', async () => {
        const { prices, errors } = await service.calculate({
            rates: RATES,
            items: [
                { supplier: 'mars', code: 'A', price: 1, currency: 'RUB' },
                { supplier: 'compel', code: 'B', price: 1, currency: 'EUR' },
                { supplier: 'compel', code: 'C', price: 0, currency: 'USD' },
                { supplier: 'compel', code: 'D', price: 1, currency: 'USD' },
            ],
        });
        expect(prices.map((p) => p.code)).toEqual(['D']);
        expect(errors.map((e) => e.code)).toEqual(['A', 'B', 'C']);
        expect(errors[0].error).toContain('неизвестный поставщик');
        expect(errors[1].error).toContain('нет курса ЦБ для EUR');
    });

    it('ни одной годной строки — цепочка останавливается, ответ с ошибками, не исключение', async () => {
        const { prices, errors } = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'nobody', code: 'A', price: 1, currency: 'RUB' }],
        });
        expect(prices).toEqual([]);
        expect(errors).toHaveLength(1);
    });
});
