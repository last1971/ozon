import { ConfigService } from '@nestjs/config';
import { OzonPricingService } from './ozon.pricing.service';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { calculatePrice, calculatePay } from '../helpers/price/price.helpers';
import { evaluateLine } from '../order/profit-check/profit-check.calculator';

const make = () => {
    const bands = [
        { min: 0, max: 300, minIncluded: true, maxIncluded: true },
        { min: 300, max: null, minIncluded: false, maxIncluded: true },
    ];
    const commissions = bands.map((band, i) => ({ ...band, rate: i ? 0.5 : 0.2 }));
    const categories = { getCommissions: jest.fn().mockResolvedValue({ fbs: commissions, fbo: commissions }) };
    const costs = {
        bands: bands.map((band, i) => ({ ...band, amount: i ? 100 : 20 })),
        firstMile: 10,
        lastMile: 25,
        returnFlow: 60,
    };
    const logistics = {
        quote: jest.fn().mockResolvedValue({ fbs: costs, fbo: { ...costs, firstMile: 0 }, acquiringRate: 0.01 }),
    };
    const config = new ConfigService({
        TAX_UNIT: 10,
        MIN_PROFIT_RUB: 20,
        MIN_PROFIT_PERC: 10,
        SUM_OBTAIN: 5,
        SUM_LABEL: 2,
        SUM_PACK: 10,
    });
    const loader = new OzonPricingService(categories as any, logistics as any, config);
    const info: any = { sku: '123-5', typeId: 8, fbsCount: 10, fboCount: 0, volumeWeight: 0.3 };
    const product: any = {
        offer_id: '123-5',
        price: { price: 900, min_price: 800, marketing_seller_price: 900 },
        commissions: {
            sales_percent_fbs: 50,
            sales_percent_fbo: 50,
            fbs_direct_flow_trans_max_amount: 100,
            fbs_direct_flow_trans_min_amount: 100,
            fbs_return_flow_amount: 60,
        },
    };
    const products: any = {
        infoList: jest.fn().mockResolvedValue([info]),
        getPrices: jest.fn().mockResolvedValue({ items: [product] }),
        setPrice: jest.fn(),
    };
    const helper = new PriceCalculationHelper(config);
    const goods = new Trade2006GoodService(null, config, null, null, helper);
    jest.spyOn(goods, 'prices').mockResolvedValue([
        { code: 123, name: 'test', price: 20, free_stock: 10, base_source: 'remaining-lots' },
    ]);
    jest.spyOn(goods, 'getPerc').mockResolvedValue([
        {
            offer_id: '123',
            pieces: 5,
            min_perc: 20,
            perc: 40,
            old_perc: 80,
            adv_perc: 0,
            packing_price: 10,
            available_price: 0,
            return_perc: 0.25,
        },
    ]);
    const priceService = new PriceService(products, goods, config, {} as any, helper, categories as any, loader);
    return { loader, categories, logistics, config, info, product, products, goods, priceService, bands };
};
describe('Данные и потребители единого расчёта Ozon', () => {
    it.each([
        [10, 0, ['fbs']],
        [0, 10, ['fbo']],
        [1, 100, ['fbs', 'fbo']],
        [0, 0, []],
    ])('учитывает остатки FBS=%s FBO=%s, без выбора по доле склада', async (fbs, fbo, expected) => {
        const m = make();
        m.info.fbsCount = fbs;
        m.info.fboCount = fbo;
        const r = await m.loader.load(m.product, m.info);
        expect(r.schemes.map((s) => s.scheme)).toEqual(expected);
    });
    it('изменение импортированных комиссий применяется при следующем запросе', async () => {
        const m = make();
        expect((await m.loader.load(m.product, m.info)).schemes[0].commissions[0].rate).toBe(0.2);
        m.categories.getCommissions.mockResolvedValue({ fbs: m.bands.map((b) => ({ ...b, rate: 0.3 })), fbo: [] });
        expect((await m.loader.load(m.product, m.info)).schemes[0].commissions[0].rate).toBe(0.3);
    });
    it('пустая комиссия или неизвестная карточка блокируют расчёт', async () => {
        const m = make();
        await expect(m.loader.load(m.product, undefined)).rejects.toThrow('карточки');
        await expect(m.loader.load(m.product, { ...m.info, sku: 'other' })).rejects.toThrow('карточки');
        m.categories.getCommissions.mockResolvedValue(null);
        await expect(m.loader.load(m.product, m.info)).rejects.toThrow('комиссий');
    });
    it('buildPriceables → цена/прибыль, экран, оптимизация и profit-check дают одинаковый результат', async () => {
        const m = make();
        const [built] = await m.goods.buildPriceables(m.priceService, ['123-5']);
        const screen = (await m.priceService.index({ offer_id: ['123-5'] } as any)).data[0];
        const coeffs = m.priceService.getObtainCoeffs();
        expect(built.ozon).toEqual(screen.ozon);
        expect(built.incoming_price).toBe(100);
        const result = calculatePrice(built, coeffs);
        expect(calculatePrice(screen, coeffs)).toEqual(result);
        expect(await m.priceService.optimizeOzonPrice(screen, coeffs, 'wrong-type')).toEqual(result);
        const price = Number(result.min_price);
        const profit = calculatePay(built, coeffs, price).netProfit;
        expect(profit).toBeGreaterThanOrEqual(20);
        const verdict = evaluateLine({ offer_id: built.offer_id, units: 3, pricePerUnit: price }, built, coeffs, 5);
        expect(verdict.minPrice).toBe(price);
        expect(verdict.profitPerUnit).toBeCloseTo(profit, 2);
        expect(m.products.setPrice).not.toHaveBeenCalled();
    });
    it.each([false, true])(
        'новая строка и строка только с возвратами получают одинаковые наценки на экране и в пересчёте: %s',
        async (onlyStatistics) => {
            const m = make();
            (m.goods.getPerc as jest.Mock).mockImplementation(async () =>
                onlyStatistics
                    ? [
                          {
                              offer_id: '123',
                              pieces: 5,
                              min_perc: null,
                              perc: null,
                              old_perc: null,
                              return_perc: 0.25,
                              return_perc_at: new Date(),
                              packing_price: 10,
                          },
                      ]
                    : [],
            );
            const [built] = await m.goods.buildPriceables(m.priceService, ['123-5']);
            const screen = (await m.priceService.index({ offer_id: ['123-5'] } as any)).data[0];
            expect([screen.min_perc, screen.perc, screen.old_perc, screen.sum_pack, screen.return_perc]).toEqual([
                built.min_perc,
                built.perc,
                built.old_perc,
                built.sum_pack,
                built.return_perc,
            ]);
            expect(calculatePrice(screen, m.priceService.getObtainCoeffs())).toEqual(
                calculatePrice(built, m.priceService.getObtainCoeffs()),
            );
        },
    );
    it('ручные наценки сохраняются; тарифы из браузера заменяются актуальными даже без typeId', async () => {
        const m = make();
        const p = (await m.goods.buildPriceables(m.priceService, ['123-5']))[0];
        const controller = new PriceController(m.priceService, null);
        const forged = { ...p, min_perc: 70, return_perc: 1, ozon: { ...p.ozon, schemes: [] } };
        const coeffs = m.priceService.getObtainCoeffs();
        const response = await controller.calculate({ price: forged, percents: coeffs });
        expect(response).toEqual(calculatePrice({ ...p, min_perc: 70 }, coeffs));
        const pay = await controller.calculatePay({ price: forged, percents: coeffs, sums: [228, 320] });
        expect(pay).toEqual([228, 320].map((sum) => calculatePay({ ...p, min_perc: 70 }, coeffs, sum)));
    });
    it('profit-check использует тариф продажи 228, хотя текущая карточка стоит 900', async () => {
        const m = make();
        const [p] = await m.goods.buildPriceables(m.priceService, ['123-5']);
        const coeffs = m.priceService.getObtainCoeffs();
        const a = calculatePay(p, coeffs, 228),
            b = calculatePay(p, coeffs, 320);
        expect(a.netProfit).toBeCloseTo(228 * 0.69 - 100 - 20 - 25 - 10 - 5 - 2 - 10 - 20, 10);
        expect(b.netProfit).toBeLessThan(a.netProfit);
        expect(
            evaluateLine({ offer_id: p.offer_id, units: 1, pricePerUnit: 228 }, p, coeffs, 5).profitPerUnit,
        ).toBeCloseTo(a.netProfit, 2);
    });
    it('ошибка тарифа не останавливает проверку остальных строк заказа и не объявляет прибыль', async () => {
        const m = make();
        const [p] = await m.goods.buildPriceables(m.priceService, ['123-5']);
        p.ozon.schemes = [];
        const verdict = evaluateLine(
            { offer_id: p.offer_id, units: 1, pricePerUnit: 228 },
            p,
            m.priceService.getObtainCoeffs(),
            5,
        );
        expect(verdict).toMatchObject({
            level: 'skip',
            profitPerUnit: null,
            reason: expect.stringContaining('Нет схемы'),
        });
    });
    it('нет контекста от API — оптимизация не возвращает цену по старым полям', async () => {
        const m = make();
        m.products.getPrices.mockResolvedValue({ items: [] });
        await expect(m.priceService.withOzonPricing({ offer_id: 'missing' } as any)).rejects.toThrow('нет тарифных');
    });
});
