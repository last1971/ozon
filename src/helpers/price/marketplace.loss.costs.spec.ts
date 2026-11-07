import { calculateMarketplaceLossCosts, MarketplaceLossCostsInput } from './marketplace.loss.costs';
import { calculateCosts, calculatePay, calculatePrice } from './price.helpers';
import { evaluateOzonPrice, OzonPricingContext } from './ozon.pricing';
import { ozonPricingInput } from './ozon.pricing.input';
import { IPriceable } from '../../interfaces/i.priceable';

const losses = (extra: Partial<MarketplaceLossCostsInput> = {}): MarketplaceLossCostsInput => ({
    purchaseCost: 100,
    defectRate: 0.1,
    confirmedDefectCompensation: 3,
    cancellationDelivery: 8,
    sellerReturnDelivery: 2,
    ...extra,
});
const band = { min: 0, max: null, minIncluded: true, maxIncluded: false };
const ozon: OzonPricingContext = {
    schemes: [
        {
            scheme: 'fbs',
            commissions: [{ ...band, rate: 0.2 }],
            logistics: [{ ...band, amount: 20 }],
            lastMile: 0,
            firstMile: 0,
            returnFlow: 60,
        },
    ],
    acquiringRate: 0,
    minProfitRub: 0,
    minMarkupPercent: 0,
    vatRate: 20,
    profitTaxRate: 20,
};
const price = (extra: Partial<IPriceable> = {}): IPriceable => ({
    offer_id: '123-5',
    incoming_price: 100,
    available_price: 0,
    sales_percent: 20,
    fbs_direct_flow_trans_max_amount: 20,
    min_perc: 20,
    perc: 40,
    old_perc: 80,
    adv_perc: 0,
    sum_pack: 0,
    return_perc: 0.25,
    return_flow_amount: 60,
    ...extra,
});
const coeffs = { sumObtain: 0, sumLabel: 0, minMil: 0, percMil: 0, percEkv: 0, taxUnit: 10 };

describe('Расходы на потери: одна точка расчёта', () => {
    it('старые входы сохраняют прежний результат', () => {
        expect(calculateMarketplaceLossCosts(undefined, 20)).toEqual({
            returns: 20,
            cancellations: 0,
            sellerReturns: 0,
            defects: 0,
            defectCompensation: 0,
            total: 20,
        });
        expect(calculateCosts(price(), coeffs).fixedCosts).toBe(40);
    });
    it('доставка, брак и подтверждённое возмещение считаются раздельно', () => {
        expect(calculateMarketplaceLossCosts(losses(), 20)).toEqual({
            returns: 20,
            cancellations: 8,
            sellerReturns: 2,
            defects: 7,
            defectCompensation: 3,
            total: 37,
        });
    });
    it('для ВБ проверенная сумма заменяет возвратную доставку Ozon, а не складывается с ней', () => {
        expect(calculateMarketplaceLossCosts(losses({ paidReturnDelivery: 4 }), 999).returns).toBe(4);
        const own = price({
            return_perc: 0.9,
            return_flow_amount: undefined,
            lossCosts: losses({ paidReturnDelivery: 4 }),
        });
        expect(calculateCosts(own, coeffs).fixedCosts).toBe(41); // 20 обычной доставки + 4 + 8 + 2 + 7.
    });
    it('возмещение закупки не гасит доставку и не создаёт отрицательный резерв брака', () => {
        const r = calculateMarketplaceLossCosts(losses({ confirmedDefectCompensation: 1000 }), 20);
        expect(r).toMatchObject({ defects: 0, defectCompensation: 10, total: 30 });
    });
    it('ручная рыночная база не используется для потери закупки', () => {
        const p = price({ incoming_price: 1000, available_price: 1000, lossCosts: losses(), ozon });
        expect(evaluateOzonPrice(ozonPricingInput(p, coeffs), 2000).costs.defects).toBe(7);
    });
    it('нулевой брак не требует отсутствующую закупку, известный ноль не считается отсутствием данных', () => {
        expect(
            calculateMarketplaceLossCosts(
                losses({
                    purchaseCost: null,
                    defectRate: 0,
                    paidReturnDelivery: 0,
                    cancellationDelivery: 0,
                    sellerReturnDelivery: 0,
                    confirmedDefectCompensation: 0,
                }),
                999,
            ).total,
        ).toBe(0);
    });
    it('брак выше 100% не обрезается', () => {
        expect(calculateMarketplaceLossCosts(losses({ defectRate: 2 }), 0).defects).toBe(197);
    });
    it('подтверждённые коррекции доставки сохраняют свой знак', () => {
        expect(
            calculateMarketplaceLossCosts(
                losses({ cancellationDelivery: -1.35, sellerReturnDelivery: -2, paidReturnDelivery: -3 }),
                0,
            ).total,
        ).toBeCloseTo(0.65);
    });
    it.each([
        'defectRate',
        'purchaseCost',
        'paidReturnDelivery',
        'cancellationDelivery',
        'sellerReturnDelivery',
    ] as const)('неизвестное %s не превращается в бесплатный расход', (field) => {
        expect(() => calculateMarketplaceLossCosts(losses({ [field]: null }), 20)).toThrow('Нет корректных данных');
    });
    it.each([NaN, Infinity, -1])('некорректная доля %s не проходит', (defectRate) => {
        expect(() => calculateMarketplaceLossCosts(losses({ defectRate }), 20)).toThrow();
    });
    it.each([NaN, Infinity, -1, null])('неверное возмещение %s не применяется', (confirmedDefectCompensation) => {
        expect(() => calculateMarketplaceLossCosts(losses({ confirmedDefectCompensation }), 20)).toThrow();
    });
    it('переполнение не выдаёт бесконечные цены', () => {
        expect(() =>
            calculateMarketplaceLossCosts(losses({ purchaseCost: Number.MAX_VALUE, defectRate: 2 }), 0),
        ).toThrow('Переполнение');
    });
    it.each([0, 10])('цена и проверка прибыли используют одни расходы: налог %s', (taxUnit) => {
        const tax = { ...coeffs, taxUnit };
        for (const market of [undefined, ozon]) {
            const p = price({ ozon: market, lossCosts: losses() });
            const result = calculatePrice(p, tax);
            const salePrice = Number(result.min_price);
            const pay = calculatePay(p, tax, salePrice);
            const profit = pay.netProfit ?? pay.pay - p.incoming_price;
            expect(profit).toBeGreaterThanOrEqual(20 - 1e-8);
            const previous = calculatePrice(price({ ozon: market }), tax);
            expect(salePrice).toBeGreaterThan(Number(previous.min_price));
            if (market) expect(evaluateOzonPrice(ozonPricingInput(p, tax), salePrice).profit).toBeCloseTo(profit);
        }
    });
    it('Ozon учитывает новые расходы ровно один раз', () => {
        const p = price({ ozon, lossCosts: losses() });
        const current = evaluateOzonPrice(ozonPricingInput(p, coeffs), 300);
        const old = evaluateOzonPrice(ozonPricingInput(price({ ozon }), coeffs), 300);
        expect(old.profit - current.profit).toBe(17);
        expect(current.costs).toMatchObject({
            returns: 20,
            cancellations: 8,
            sellerReturns: 2,
            defects: 7,
            defectCompensation: 3,
        });
    });
});
