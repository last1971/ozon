import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupplierPriceService } from './supplier.price.service';
import { SupplierPriceStrategyRegistry } from './supplier.price.strategy.registry';
import { DefaultMarkup } from './strategies/default.markup';
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
                DefaultMarkup,
                ValidateBatchCommand,
                ConvertCurrencyCommand,
                AddDeliveryCommand,
                ApplyMarkupCommand,
                BuildResponseCommand,
                { provide: PriceCalculationHelper, useValue: helper },
                { provide: SyliusPriceService, useValue: sylius },
            ],
        }).compile();
        service = module.get(SupplierPriceService);
    });

    it('1N4007 у Компэла: $0.0186 → рубли по ЦБ+2%, доставка 0, наценка как у наших (дешёвое — больше)', async () => {
        const { prices, errors } = await service.calculate({
            rates: RATES,
            items: [{ supplier: 'compel', code: '1N4007', price: 0.0186, currency: 'USD' }],
        });
        expect(errors).toEqual([]);
        const p = prices[0];
        expect(p.incoming_price).toBeCloseTo(1.53, 2); // 0.0186 × 80.54 × 1.02
        expect(p.delivery).toBe(0);
        // Цена больше нуля, минимальная ≤ обычная ≤ зачёркнутая, и на минимальной остаётся не меньше 20 ₽ прибыли
        expect(p.min_price).toBeGreaterThan(0);
        expect(p.price).toBeGreaterThanOrEqual(p.min_price);
        expect(p.old_price).toBeGreaterThanOrEqual(p.price);
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
        expect(
            calculatePay(priceable, sylius.getObtainCoeffs(), p.min_price).pay - p.incoming_price,
        ).toBeGreaterThanOrEqual(20);
        expect(p.min_perc).toBeGreaterThan(100); // дешёвой детали процент большой (подбор под 20 ₽ прибыли)
    });

    it('STM32F103C8T6 у Компэла: $2.9 → процент меньше, чем у дешёвого', async () => {
        const { prices } = await service.calculate({
            rates: RATES,
            items: [
                { supplier: 'compel', code: 'STM32F103C8T6', price: 2.9, currency: 'USD' },
                { supplier: 'compel', code: '1N4007', price: 0.0186, currency: 'USD' },
            ],
        });
        const stm = prices.find((p) => p.code === 'STM32F103C8T6');
        const diode = prices.find((p) => p.code === '1N4007');
        expect(stm.incoming_price).toBeCloseTo(2.9 * 80.54 * 1.02, 2); // 238.24
        expect(stm.min_perc).toBeLessThan(diode.min_perc);
        expect(stm.price).toBeGreaterThan(stm.incoming_price);
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
        expect(tiers.map((t) => t.quantity)).toEqual([100, 1000]);
        expect(tiers[0].price).toBeLessThanOrEqual(prices[0].price);
        expect(tiers[1].price).toBeLessThanOrEqual(tiers[0].price);
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
