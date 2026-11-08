import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { OzonPricingPreviewDto } from './dto/ozon-pricing-result.dto';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';
import { calculateOzonPrices, OzonPricingContext } from '../helpers/price/ozon.pricing';
import { ozonPricingInput } from '../helpers/price/ozon.pricing.input';

function setup() {
    const config = new ConfigService({ TAX_UNIT: 10, SUM_PACK: 0, SUM_LABEL: 0, SUM_OBTAIN: 0 });
    const helper = new PriceCalculationHelper(config);
    const goods = new Trade2006GoodService(null, config, null, null, helper);
    const good = { code: 123, name: 'Товар', price: 20, free_stock: 10, base_source: 'remaining-lots' as const };
    const percent = {
        offer_id: '123',
        pieces: 5,
        min_perc: 20,
        perc: 40,
        old_perc: 80,
        adv_perc: 0,
        packing_price: 0,
        available_price: 0,
        return_perc: 0.25,
    };
    jest.spyOn(goods, 'prices').mockResolvedValue([good]);
    jest.spyOn(goods, 'getPerc').mockImplementation(async () => [{ ...percent }]);
    jest.spyOn(goods, 'setPercents').mockResolvedValue(undefined);
    const product = { offer_id: '123-5', price: { price: '900', min_price: '800', old_price: '1000' } };
    const info = { sku: '123-5', fbsCount: 10, fboCount: 0 };
    const products = {
        getPrices: jest.fn().mockResolvedValue({ items: [product] }),
        infoList: jest.fn().mockResolvedValue([info]),
        setPrice: jest.fn(),
    };
    const bands = [
        { min: 0, max: 300, minIncluded: true, maxIncluded: true },
        { min: 300, max: null, minIncluded: false, maxIncluded: true },
    ];
    const context: OzonPricingContext = {
        schemes: [
            {
                scheme: 'fbs',
                commissions: bands.map((b, i) => ({ ...b, rate: i ? 0.5 : 0.2 })),
                logistics: bands.map((b, i) => ({ ...b, amount: i ? 100 : 20 })),
                firstMile: 0,
                lastMile: 0,
                returnFlow: 60,
            },
        ],
        acquiringRate: 0,
        minProfitRub: 20,
        minMarkupPercent: 10,
        vatRate: 20,
        profitTaxRate: 20,
    };
    const pricing = { prepare: jest.fn().mockResolvedValue(undefined), load: jest.fn().mockResolvedValue(context) };
    const service = new PriceService(products as any, goods, config, null, helper, null, pricing as any);
    return { service, products, goods, good, percent, product, info, pricing, context };
}

describe('Результат единой формулы для экрана цен', () => {
    it('возвращает три цены, прибыль, ставку выбранной ступени и отдельный снимок Ozon', async () => {
        const m = setup();
        const result = await m.service.getOzonPricingResult('123-5');
        expect(result).toMatchObject({
            offerId: '123-5',
            baseSource: 'remaining-lots',
            base: 100,
            current: { min: 800, normal: 900, max: 1000 },
            min: { price: 229, scheme: 'fbs', commissionRate: 0.2 },
            normal: { price: 258, scheme: 'fbs', commissionRate: 0.2 },
            max: { price: 800, scheme: 'fbs', commissionRate: 0.5 },
            deadZoneFloor: 650,
        });
        expect(result.min.profit).toBeCloseTo(20.3);
        expect(result.costs).toMatchObject({ delivery: 20, returns: 20, packing: 0, tax: 22.9 });
        expect(result.costs).not.toHaveProperty('base');
        expect(m.pricing.load).toHaveBeenCalledWith(m.product, m.info);
        expect(m.goods.setPercents).not.toHaveBeenCalled();
        expect(m.products.setPrice).not.toHaveBeenCalled();
    });
    it('объясняет ограничение процента и отказ нижней ступени той же формулой', async () => {
        const m = setup();
        m.context.minMarkupPercent = 40;
        m.context.minProfitRub = 0;
        const r = await m.service.getOzonPricingResult('123-5', { min_perc: 5 });
        expect(r.min).toMatchObject({ requestedMarkup: 5, appliedMarkup: 40, targetProfit: 40 });
        expect(r.limits).toEqual({ minProfitRub: 0, minMarkupPercent: 40 });
        expect(r.lowerBand).toMatchObject({ ceiling: 300, eligible: true, targetProfit: 40 });
        expect(r.costSources.commission).toBe('XLSX комиссий');
        expect(r.costSources.firstMile).toBe('API Ozon');
        m.context.minProfitRub = 100;
        const higher = await m.service.getOzonPricingResult('123-5', { min_perc: 5 });
        expect(higher.lowerBand.eligible).toBe(false);
        expect(higher.lowerBand.profit).toBeLessThan(higher.lowerBand.targetProfit);
        expect(higher.min.price).toBeGreaterThan(300);
    });
    it('прибыль текущей цены и расчётной берётся из одной функции', async () => {
        const m = setup();
        (m.product.price as any).marketing_seller_price = '229';
        const r = await m.service.getOzonPricingResult('123-5');
        expect(r.buyer.profit).toBeCloseTo(r.min.profit);
        expect(r.buyer.profitPercent).toBeCloseTo(r.min.profitPercent);
    });
    it('ручные API игнорируют устаревшие расходы браузера и используют серверные', async () => {
        const m = setup();
        const p = {
            offer_id: '123-5',
            incoming_price: 100,
            available_price: 0,
            base_source: 'remaining-lots' as const,
            ozon: m.context,
            min_perc: 20,
            perc: 40,
            old_perc: 80,
            adv_perc: 0,
            sum_pack: 0,
            return_perc: 0.25,
            sales_percent: 0,
            fbs_direct_flow_trans_max_amount: 0,
        };
        jest.spyOn(m.service, 'withOzonPricing').mockResolvedValue(p);
        const stale = { ...m.service.getObtainCoeffs(), sumObtain: 55, percEkv: 99 };
        const controller = new PriceController(m.service, null);
        const pay = await controller.calculatePay({ price: p, percents: stale, sums: [229] });
        expect(pay[0].netProfit).toBeCloseTo(20.3);
        const calculated = await controller.calculate({ price: p, percents: stale });
        expect(calculated.min_price).toBe('229');
    });
    it('ручные входы меняют предварительный расчёт, но не сохранённые данные и не цены Ozon', async () => {
        const m = setup();
        const baseline = await m.service.getOzonPricingResult('123-5');
        const result = await m.service.getOzonPricingResult('123-5', {
            min_perc: 50,
            perc: 60,
            old_perc: 90,
            adv_perc: 2,
            sum_pack: 3,
            available_price: 150,
        });
        const expected = calculateOzonPrices(
            ozonPricingInput(
                {
                    offer_id: '123-5',
                    ozon: m.context,
                    base_source: 'market',
                    incoming_price: 150,
                    available_price: 150,
                    min_perc: 50,
                    perc: 60,
                    old_perc: 90,
                    adv_perc: 2,
                    sum_pack: 3,
                    return_perc: 0.25,
                    sales_percent: 0,
                    fbs_direct_flow_trans_max_amount: 0,
                },
                m.service.getObtainCoeffs(),
            ),
        );
        expect(result).toMatchObject({
            baseSource: 'market',
            base: 150,
            min: { price: expected.min.salePrice, profit: expected.min.profit },
            normal: { price: expected.normal.salePrice },
            max: { price: expected.max.salePrice },
            current: baseline.current,
        });
        expect(result.min.price).toBeGreaterThan(baseline.min.price);
        expect(m.percent.min_perc).toBe(20);
        expect(m.goods.setPercents).not.toHaveBeenCalled();
        expect(m.products.setPrice).not.toHaveBeenCalled();
        expect(await m.service.getOzonPricingResult('123-5')).toEqual(baseline);
    });
    it('рыночная база относится ко всей фасовке, ноль возвращает базу из закупки', async () => {
        const m = setup();
        m.percent.available_price = 150;
        expect((await m.service.getOzonPricingResult('123-5')).base).toBe(150);
        expect(await m.service.getOzonPricingResult('123-5', { available_price: 0 })).toMatchObject({
            base: 100,
            baseSource: 'remaining-lots',
        });
    });
    it.each(['товар', 'карточка', 'база', 'остаток', 'тариф', 'API'])(
        'нет %s — ошибка без выдуманных цен',
        async (missing) => {
            const m = setup();
            if (missing === 'товар') m.products.getPrices.mockResolvedValue({ items: [] });
            if (missing === 'карточка') m.products.infoList.mockResolvedValue([{ sku: 'other' }]);
            if (missing === 'база') m.good.price = 0;
            if (missing === 'остаток') m.good.free_stock = 0;
            if (missing === 'тариф') m.pricing.load.mockRejectedValue(new Error('Нет тарифов'));
            if (missing === 'API') m.products.getPrices.mockRejectedValue(new Error('API недоступен'));
            expect(await m.service.getOzonPricingResult('123-5')).toMatchObject({
                offerId: '123-5',
                baseSource: missing === 'тариф' ? 'remaining-lots' : 'none',
                base: missing === 'тариф' ? 100 : 0,
                error: expect.any(String),
                min: null,
                normal: null,
                max: null,
                costs: null,
                current: ['товар', 'API'].includes(missing) ? null : { min: 800, normal: 900, max: 1000 },
            });
        },
    );
    it.each([false, true])('подбирает отсутствующие наценки без записи, только возвраты: %s', async (onlyReturns) => {
        const m = setup();
        (m.goods.getPerc as jest.Mock).mockResolvedValue(
            onlyReturns
                ? [{ ...m.percent, min_perc: null, perc: null, old_perc: null, return_perc_at: new Date() }]
                : [],
        );
        const generate = jest.spyOn(m.goods, 'generatePercentsForService');
        const result = await m.service.getOzonPricingResult('123-5');
        expect(result.error).toBeUndefined();
        expect(result.min.price).toBeGreaterThan(0);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(result.costs.returns).toBe(onlyReturns ? 20 : 0);
        expect(m.goods.setPercents).not.toHaveBeenCalled();
    });
    it('не берёт наценки или возвраты чужой фасовки', async () => {
        const m = setup();
        (m.goods.getPerc as jest.Mock).mockResolvedValue([
            { ...m.percent, pieces: 1, return_perc: 1, available_price: 900 },
        ]);
        const result = await m.service.getOzonPricingResult('123-5');
        expect(result.base).toBe(100);
        expect(result.costs.returns).toBe(0);
    });
    it('без нижней ступени предупреждения о мёртвой зоне нет', async () => {
        const m = setup();
        const scheme = m.context.schemes[0];
        scheme.commissions = [{ min: 0, max: null, minIncluded: true, maxIncluded: false, rate: 0.2 }];
        scheme.logistics = [{ min: 0, max: null, minIncluded: true, maxIncluded: false, amount: 20 }];
        expect((await m.service.getOzonPricingResult('123-5')).deadZoneFloor).toBeUndefined();
    });
    it('отдаёт схему с худшей прибылью при двух остатках', async () => {
        const m = setup();
        m.context.schemes.push({ ...m.context.schemes[0], scheme: 'fbo', firstMile: 10 });
        expect((await m.service.getOzonPricingResult('123-5')).min.scheme).toBe('fbo');
    });
    it.each([-1, NaN, Infinity])('некорректная наценка %s не превращается в цену', async (value) => {
        const m = setup();
        expect((await m.service.getOzonPricingResult('123-5', { min_perc: value })).error).toContain('min_perc');
        expect(m.pricing.load).not.toHaveBeenCalled();
    });
    it('при ОСНО передаёт НДС и налог на прибыль из общей формулы', async () => {
        const m = setup();
        jest.spyOn(m.service, 'getObtainCoeffs').mockReturnValue({
            sumObtain: 0,
            sumLabel: 0,
            minMil: 0,
            percMil: 0,
            percEkv: 0,
            taxUnit: 0,
        });
        const r = await m.service.getOzonPricingResult('123-5');
        expect(r.error).toBeUndefined();
        expect(r.costs.tax).toBe(0);
        expect(r.costs.vat).toBeGreaterThan(0);
        expect(r.costs.profitTax).toBeGreaterThan(0);
    });
    it('контроллер делегирует данные и предварительные наценки сервису', async () => {
        const service = { getOzonPricingResult: jest.fn().mockResolvedValue({ offerId: '123-5' }) };
        const controller = new PriceController(service as any, null);
        expect(await controller.ozonPricingResult('123-5', { min_perc: 25 })).toEqual({ offerId: '123-5' });
        expect(service.getOzonPricingResult).toHaveBeenCalledWith('123-5', { min_perc: 25 });
    });
    it('query преобразует числа и отклоняет отрицательные и нечисловые значения', async () => {
        const valid = plainToInstance(OzonPricingPreviewDto, { min_perc: '0', sum_pack: '2.5' });
        expect(await validate(valid)).toEqual([]);
        expect(valid).toMatchObject({ min_perc: 0, sum_pack: 2.5 });
        for (const value of ['-1', 'abc', 'Infinity']) {
            expect(
                (await validate(plainToInstance(OzonPricingPreviewDto, { min_perc: value }))).length,
            ).toBeGreaterThan(0);
        }
    });
});

it('ошибка тарифа сохраняет известную себестоимость и текущие цены', async () => {
    const m = setup();
    m.pricing.load.mockRejectedValue(new Error('Нет импортированных комиссий Ozon'));
    expect(await m.service.getOzonPricingResult('123-5')).toMatchObject({
        base: 100,
        baseSource: 'remaining-lots',
        current: { min: 800, normal: 900, max: 1000 },
        min: null,
        normal: null,
        max: null,
        error: 'Нет импортированных комиссий Ozon',
    });
});
it('неизвестная доставка отказов не скрывает приход и не мешает расчёту', async () => {
    const m = setup();
    m.context.lossStatistics = {
        defectRate: null,
        cancellationDelivery: null,
        sellerReturnDelivery: null,
        confirmedDefectCompensation: 0,
    };
    const before = structuredClone(m.context.lossStatistics);
    const result = await m.service.getOzonPricingResult('123-5');
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({
        base: 100,
        baseSource: 'remaining-lots',
        costs: { cancellations: 0, sellerReturns: 0, defects: 0, returns: 20 },
    });
    expect(result.min.price).toBeGreaterThan(0);
    expect(m.context.lossStatistics).toEqual(before);
});

it('сценарий 553019: имеющийся приход сохраняет базу при неизвестных отказах', async () => {
    const m = setup();
    m.good.code = 553019;
    m.good.price = 1112.9848333333332;
    m.good.free_stock = 49;
    m.percent.offer_id = '553019';
    m.percent.pieces = 1;
    m.product.offer_id = '553019';
    m.info.sku = '553019';
    m.context.lossStatistics = {
        defectRate: 0,
        cancellationDelivery: null,
        sellerReturnDelivery: 0,
        confirmedDefectCompensation: 0,
    };
    const result = await m.service.getOzonPricingResult('553019');
    expect(result.error).toBeUndefined();
    expect(result.base).toBe(1112.9848333333332);
    expect(result.baseSource).toBe('remaining-lots');
    expect(result.costs.cancellations).toBe(0);
    expect(result.min.price).toBeGreaterThan(result.base);
    expect(m.context.lossStatistics.cancellationDelivery).toBeNull();
});

it.each([-1, NaN, Infinity])('неверный процент %s не скрывает прочитанную себестоимость', async (value) => {
    const m = setup();
    expect(await m.service.getOzonPricingResult('123-5', { min_perc: value })).toMatchObject({
        base: 100,
        baseSource: 'remaining-lots',
        current: { min: 800, normal: 900, max: 1000 },
        min: null,
        error: 'Некорректное значение min_perc',
    });
    expect(m.pricing.load).not.toHaveBeenCalled();
});
