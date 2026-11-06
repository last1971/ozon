import { ConfigService } from '@nestjs/config';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';
import { calculateCosts, calculatePay, calculatePrice } from '../helpers/price/price.helpers';
import { ozonReturnPriceFields } from '../helpers/price/ozon.return.perc';
import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';
import { PriceService } from './price.service';
import { ProductPriceDto } from './dto/product.price.dto';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { IPriceable } from '../interfaces/i.priceable';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { evaluateLine } from '../order/profit-check/profit-check.calculator';

const coeffs: ObtainCoeffsDto = { sumObtain: 0, sumLabel: 0, minMil: 0, percMil: 0, percEkv: 0, taxUnit: 10 };
const price: IPriceable = {
    offer_id: '123-5',
    incoming_price: 100,
    available_price: 0,
    sum_pack: 0,
    min_perc: 20,
    perc: 40,
    old_perc: 80,
    sales_percent: 0,
    adv_perc: 0,
    fbs_direct_flow_trans_max_amount: 100,
    return_flow_amount: 60,
    return_perc: 0.25,
};
const rawProduct: ProductPriceDto = {
    offer_id: '123-5',
    price: {},
    commissions: {
        fbs_direct_flow_trans_min_amount: 80,
        fbs_direct_flow_trans_max_amount: 120,
        fbs_return_flow_amount: 60,
        fbo_direct_flow_trans_min_amount: 40,
        fbo_direct_flow_trans_max_amount: 80,
        fbo_return_flow_amount: 20,
        sales_percent_fbs: 0,
        sales_percent_fbo: 0,
    },
} as ProductPriceDto;
const info = { sku: '123-5', fbsCount: 10, fboCount: 0 } as ProductInfoDto;

function setup(
    rows = [
        {
            GOODSCODE: 123,
            PIECES: 5,
            PERC_MIN: 20,
            PERC_NOR: 40,
            PERC_MAX: 80,
            PERC_ADV: 0,
            PACKING_PRICE: 0,
            AVAILABLE_PRICE: 0,
            RETURN_PERC: 0.25,
            RETURN_PERC_AT: new Date(),
        },
    ],
) {
    const config = new ConfigService({ TAX_UNIT: 10, SUM_PACK: 0, PERC_DIRECT_FLOW: 0 });
    const helper = new PriceCalculationHelper(config);
    const t = { query: jest.fn().mockResolvedValue(rows), commit: jest.fn(), rollback: jest.fn() };
    const goods = new Trade2006GoodService({ getTransaction: async () => t } as any, config, null, null, helper);
    jest.spyOn(goods, 'prices').mockResolvedValue([{ code: 123, name: 'test', price: 20, free_stock: 10 }]);
    const band = { min: 0, max: null, minIncluded: true, maxIncluded: false };
    const pricing: any = {
        schemes: [
            {
                scheme: 'fbs',
                commissions: [{ ...band, rate: 0 }],
                logistics: [{ ...band, amount: 100 }],
                lastMile: 0,
                firstMile: 0,
                returnFlow: 60,
            },
        ],
        acquiringRate: 0,
        minProfitRub: 20,
        minMarkupPercent: 10,
        vatRate: 20,
        profitTaxRate: 20,
    };
    const adapter = new OzonProductCoeffsAdapter(rawProduct, 1, info, helper, pricing);
    const products = {
        infoList: jest.fn().mockResolvedValue([info]),
        getPrices: jest.fn().mockResolvedValue({ items: [rawProduct], cursor: '' }),
    };
    const service = new PriceService(products as any, goods, config, null, helper, null, {
        prepare: async () => {},
        load: async () => pricing,
    } as any);
    const market = { getProductsWithCoeffs: async () => [adapter], getObtainCoeffs: () => coeffs } as any;
    return { goods, helper, market, service, t };
}

describe('Возвраты в едином расчёте расходов', () => {
    it('25% × (60 обратная + 100 прямая) = 40 рублей сверх обычной доставки', () => {
        expect(calculateCosts(price, coeffs)).toEqual({ fixedCosts: 140, dynamicCosts: 10 });
        expect(calculatePrice(price, coeffs).min_price).toBe('289'); // ceil((100 × 1.2 + 140) / 0.9)
        expect(calculatePay(price, coeffs, 300).pay).toBe(130);
        const verdict = evaluateLine({ offer_id: '123-5', units: 2, pricePerUnit: 300 }, price, coeffs, 5);
        expect(verdict).toMatchObject({ minPrice: 289, profitPerUnit: 30, profitTotal: 60 });
    });
    it('при 100% прибавляет всю прямую и обратную логистику один раз', () => {
        expect(calculateCosts({ ...price, return_perc: 1 }, coeffs).fixedCosts).toBe(260);
    });
    it('при нуле или без статистики прежняя цена сохраняется, тариф возврата необязателен', () => {
        for (const return_perc of [0, null, undefined]) {
            expect(calculateCosts({ ...price, return_perc, return_flow_amount: undefined }, coeffs).fixedCosts).toBe(
                100,
            );
            expect(calculatePrice({ ...price, return_perc }, coeffs).min_price).toBe('245');
        }
    });
    it('ОСНО и УСН используют те же расходы', () => {
        for (const taxUnit of [0, 10]) {
            const tax = { ...coeffs, taxUnit };
            const without = { ...price, return_perc: 0 };
            expect(Number(calculatePrice(price, tax).min_price)).toBeGreaterThan(
                Number(calculatePrice(without, tax).min_price),
            );
            expect(calculatePay(price, tax, 400).pay).toBeLessThan(calculatePay(without, tax, 400).pay);
        }
    });
    it.each([-0.1, 1.1, NaN, Infinity])('отклоняет долю %s', (return_perc) => {
        expect(() => calculateCosts({ ...price, return_perc }, coeffs)).toThrow('доля');
    });
    it.each([undefined, null, -1, NaN, Infinity])(
        'ненулевая доля требует корректного тарифа возврата: %s',
        (return_flow_amount) => {
            expect(() => calculateCosts({ ...price, return_flow_amount }, coeffs)).toThrow('тарифа');
        },
    );
    it('нулевой тариф валиден, неверная прямая логистика блокирует расчёт', () => {
        expect(calculateCosts({ ...price, return_flow_amount: 0 }, coeffs).fixedCosts).toBe(125);
        expect(() => calculateCosts({ ...price, fbs_direct_flow_trans_max_amount: NaN }, coeffs)).toThrow();
    });
    it('FBO/FBS берут обратный тариф той же схемы, без множителя прямой логистики', () => {
        const fbs = new OzonProductCoeffsAdapter(rawProduct, 1.2, info);
        const fbo = new OzonProductCoeffsAdapter(rawProduct, 1.2, { ...info, fboCount: 100 });
        expect(fbs.getReturnFlowAmount()).toBe(60);
        expect(fbo.getReturnFlowAmount()).toBe(20);
        expect(fbs.getTransMaxAmount()).toBe(120);
        expect(fbo.getTransMaxAmount()).toBe(72);
    });
    it('другим площадкам процент Ozon не передаётся', () => {
        expect(
            ozonReturnPriceFields(
                { getSku: () => '123-5', getSalesPercent: () => 10, getTransMaxAmount: () => 100 },
                1,
            ),
        ).toEqual({});
    });
    it('нет коэффициента в ответе Ozon — не выдумывает нулевой тариф', () => {
        const adapter = new OzonProductCoeffsAdapter(
            { ...rawProduct, commissions: { ...rawProduct.commissions, fbs_return_flow_amount: undefined } },
            1,
            info,
        );
        expect(() => calculateCosts({ ...price, ...ozonReturnPriceFields(adapter, 0.25) }, coeffs)).toThrow('тарифа');
    });
    it('путь БД → buildPriceables → цена/прибыль совпадает с экраном', async () => {
        const { goods, market, service } = setup();
        const [built] = await goods.buildPriceables(market, ['123-5']);
        const screen = (await service.index({ offer_id: ['123-5'] } as any)).data[0];
        expect(built).toMatchObject({ return_perc: 0.25, return_flow_amount: 60 });
        expect(screen).toMatchObject({ return_perc: 0.25, return_flow_amount: 60 });
        expect(calculatePrice(built, coeffs).min_price).toBe('289');
        expect(calculatePrice(screen, coeffs).min_price).toBe('289');
        expect(calculatePay(built, coeffs, 300)).toEqual(calculatePay(screen, coeffs, 300));
    });
    it('чужая фасовка не передаёт свой процент', async () => {
        const { goods, market } = setup([
            {
                GOODSCODE: 123,
                PIECES: 1,
                PERC_MIN: 20,
                PERC_NOR: 40,
                PERC_MAX: 80,
                PERC_ADV: 0,
                PACKING_PRICE: 0,
                AVAILABLE_PRICE: 0,
                RETURN_PERC: 1,
                RETURN_PERC_AT: new Date(),
            },
        ]);
        expect((await goods.buildPriceables(market, ['123-5']))[0].return_perc).toBe(0);
    });
    it('строка только со статистикой не отключает автоматический подбор наценок', async () => {
        const { goods, market, helper } = setup([
            {
                GOODSCODE: 123,
                PIECES: 5,
                PERC_MIN: null,
                PERC_NOR: null,
                PERC_MAX: null,
                PERC_ADV: null,
                PACKING_PRICE: 0,
                AVAILABLE_PRICE: null,
                RETURN_PERC: 0.25,
                RETURN_PERC_AT: new Date(),
            },
        ]);
        const spy = jest.spyOn(helper, 'adjustPercents');
        const [built] = await goods.buildPriceables(market, ['123-5']);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(built.min_perc).toBeGreaterThan(0);
        expect(built.return_perc).toBe(0.25);
        expect(built.return_flow_amount).toBe(60);
    });
    it('подбор наценок для Ozon получает тот же процент и расходы', async () => {
        const { goods, market, helper } = setup();
        const spy = jest.spyOn(helper, 'adjustPercents');
        await goods.generatePercentsForService(market, ['123-5']);
        expect(spy.mock.calls[0][0]).toMatchObject({ return_perc: 0.25, return_flow_amount: 60 });
    });
    it('обновление ручных наценок не записывает и не стирает автоматическую статистику', async () => {
        const { goods, t } = setup();
        const execute = jest.fn();
        await goods.setPercents({ offer_id: '123', pieces: 5, min_perc: 10, return_perc: 1 }, { ...t, execute } as any);
        expect(execute.mock.calls[0][0]).not.toMatch(/RETURN_PERC/);
    });
});
