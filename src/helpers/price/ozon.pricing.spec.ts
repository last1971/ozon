import { calculateOzonPrices, evaluateOzonPrice, OzonPricingInput } from './ozon.pricing';
import { calculatePay, calculatePrice, calculateOSNODetails } from './price.helpers';
import { ozonPricingInput } from './ozon.pricing.input';

const low = { min: 0, max: 300, minIncluded: true, maxIncluded: true };
const high = { min: 300, max: null, minIncluded: false, maxIncluded: false };
const input = (overrides: Partial<OzonPricingInput> = {}): OzonPricingInput => ({
    base: 100,
    baseSource: 'market',
    markups: { min: 20, normal: 40, max: 80 },
    minProfitRub: 20,
    minMarkupPercent: 10,
    acquiringRate: 0,
    advertisingPercent: 0,
    packing: 0,
    label: 0,
    handling: 0,
    taxPercent: 10,
    vatRate: 20,
    profitTaxRate: 20,
    returnRate: 0,
    schemes: [
        {
            scheme: 'fbs',
            commissions: [
                { ...low, rate: 0.2 },
                { ...high, rate: 0.5 },
            ],
            logistics: [
                { ...low, amount: 20 },
                { ...high, amount: 100 },
            ],
            lastMile: 0,
            firstMile: 0,
            returnFlow: 60,
        },
    ],
    ...overrides,
});
const coeffs = { sumObtain: 0, sumLabel: 0, taxUnit: 10, minMil: 999, percMil: 99, percEkv: 99 };
const priceable = (i = input()): any => ({
    offer_id: '123-5',
    incoming_price: i.base,
    available_price: 0,
    base_source: i.baseSource,
    min_perc: i.markups.min,
    perc: i.markups.normal,
    old_perc: i.markups.max,
    adv_perc: i.advertisingPercent,
    sum_pack: i.packing,
    return_perc: i.returnRate,
    sales_percent: 99,
    fbs_direct_flow_trans_max_amount: 999,
    ozon: i,
});

describe('Единая цена Ozon по тарифным ступеням', () => {
    it('два независимых расчёта: 200 и 550, выбирает 200', () => {
        const r = calculateOzonPrices(input());
        expect(r.min.candidates.map((c) => c.price)).toEqual([200, 550]);
        expect(r.min.price).toBe(200); // (100 + 20 прибыли + 20 доставки) / (1 - 20% - 10%)
        expect(r.min.candidates.some((c) => c.price === 550)).toBe(true);
        expect(r.min.profit).toBeCloseTo(20, 10);
    });
    it('нижний кандидат выше 300 исключается; цена верхней ступени = 850', () => {
        const r = calculateOzonPrices(input({ base: 200 }));
        expect(r.min.price).toBe(850); // (200 + 40 + 100) / 0.4
        expect(r.min.candidates.every((c) => c.salePrice > 300)).toBe(true);
    });
    it('ровно 300 допустимо в нижней ступени, 301 проверяется с верхними расходами', () => {
        const i = input({ base: 160, markups: { min: 18.75, normal: 18.75, max: 18.75 } });
        expect(calculateOzonPrices(i).min.price).toBe(300);
        expect(evaluateOzonPrice(i, 300).costs.delivery).toBe(20);
        expect(evaluateOzonPrice(i, 301).costs.delivery).toBe(100);
        expect(evaluateOzonPrice(i, 301).profit).toBeLessThan(0);
    });
    it('обычная и максимальная цены также не попадают в убыточную зону над 300', () => {
        const r = calculateOzonPrices(input({ base: 160, markups: { min: 10, normal: 30, max: 50 } }));
        expect(r.min.price).toBeLessThanOrEqual(300);
        expect(r.normal.price).toBeGreaterThan(700);
        for (const level of [r.min, r.normal, r.max]) expect(level.profit).toBeGreaterThanOrEqual(level.targetProfit);
        expect(r.max.price).toBeGreaterThanOrEqual(r.normal.price);
    });
    it('дешёвая верхняя ступень получает минимум 301, даже если её формула даёт цену ниже 300', () => {
        const i = input({ base: 200 });
        i.schemes[0].commissions[1].rate = 0;
        i.schemes[0].logistics[1].amount = 0;
        expect(calculateOzonPrices(i).min.price).toBe(301);
    });
    it('поддерживает изменённые границы и число ступеней', () => {
        const i = input({ base: 200 });
        i.schemes[0].commissions = [
            { ...low, max: 500, rate: 0.2 },
            { ...high, min: 500, rate: 0.5 },
        ];
        i.schemes[0].logistics = [
            { ...low, max: 250, amount: 20 },
            { min: 250, max: 500, minIncluded: false, maxIncluded: true, amount: 30 },
            { ...high, min: 500, amount: 100 },
        ];
        const r = calculateOzonPrices(i);
        expect(r.min.price).toBe(386); // (200 + 40 + 30) / .7
        expect(r.min.logisticsBand.min).toBe(250);
    });
    it('берёт худшую полную прибыль, а не схему с большей комиссией', () => {
        const i = input();
        i.schemes.push({
            ...i.schemes[0],
            scheme: 'fbo',
            commissions: [
                { ...low, rate: 0.1 },
                { ...high, rate: 0.1 },
            ],
            logistics: [
                { ...low, amount: 100 },
                { ...high, amount: 200 },
            ],
        });
        const r = calculateOzonPrices(i);
        expect(r.min.price).toBe(275);
        expect(r.min.scheme).toBe('fbo');
        for (const scheme of i.schemes)
            expect(evaluateOzonPrice({ ...i, schemes: [scheme] }, r.min.salePrice).profit).toBeGreaterThanOrEqual(20);
    });
    it('FBO может быть единственной схемой', () => {
        const i = input();
        i.schemes[0].scheme = 'fbo';
        expect(calculateOzonPrices(i).min.scheme).toBe('fbo');
    });
    it('возвраты 100%, 25%, 0%: прямая и обратная логистика учитываются один раз', () => {
        for (const rate of [1, 0.25, 0]) {
            const e = evaluateOzonPrice(input({ returnRate: rate }), 250);
            expect(e.costs.returns).toBe(rate * 80);
            expect(e.profit).toBeCloseTo(55 - rate * 80, 10);
        }
    });
    it('все статьи расходов и минимум в рублях/процентах входят в расчёт', () => {
        const i = input({
            packing: 10,
            label: 2,
            handling: 5,
            acquiringRate: 0.01,
            advertisingPercent: 3,
            minProfitRub: 50,
        });
        i.schemes[0].lastMile = 25;
        i.schemes[0].firstMile = 10;
        const e = evaluateOzonPrice(i, 250);
        expect(e.costs).toMatchObject({
            commission: 50,
            acquiring: 2.5,
            advertising: 7.5,
            tax: 25,
            packing: 10,
            label: 2,
            handling: 5,
            lastMile: 25,
            firstMile: 10,
        });
        expect(e.profit).toBe(-7);
        expect(calculateOzonPrices(i).min.targetProfit).toBe(50);
        expect(calculateOzonPrices(input({ minMarkupPercent: 60 })).min.targetProfit).toBe(60);
    });
    it('фасовка не умножает повторно базу пачки и расходы доставки', () => {
        const p = priceable();
        expect(calculatePrice(p, coeffs).min_price).toBe('200');
        expect(calculatePrice({ ...p, offer_id: '123-1000' }, coeffs).min_price).toBe('200');
    });
    it('проверка продажи выбирает её ступень, а не тариф текущей карточки', () => {
        const p = priceable();
        const pay = calculatePay(p, coeffs, 228);
        expect(pay.netProfit).toBeCloseTo(39.6, 10);
        expect(pay.pay).toBeCloseTo(139.6, 10);
        expect(calculatePay(p, coeffs, 320).netProfit).toBe(-72);
    });
    it('скидка учитывается до выбора ступени; возвращаются цена до и после скидки', () => {
        const i = input({ discountRate: 0.2 });
        const r = calculateOzonPrices(i);
        expect(r.min.price).toBe(250);
        expect(r.min.salePrice).toBe(200);
        expect(r.min.profit).toBe(20);
        expect(evaluateOzonPrice(i, r.min.salePrice).profit).toBe(r.min.profit);
    });
    it('контроль 560209-1: база 63.35, комиссия 51%, доставка API (43+305)/2 = 174', () => {
        const i = input({ base: 63.35, packing: 10, label: 2, handling: 5, acquiringRate: 0.01, taxPercent: 11 });
        i.schemes[0] = {
            scheme: 'fbs',
            commissions: [{ ...high, rate: 0.51 }],
            logistics: [{ ...high, amount: 174 }],
            lastMile: 25,
            firstMile: 10,
            returnFlow: 305,
        };
        const r = calculateOzonPrices(i);
        expect(r.min.price).toBe(837); // ceil((63.35 + 20 + 10 + 2 + 5 + 25 + 10 + 174) / .37)
        expect(r.min.profit).toBeCloseTo(20.34, 10);
    });
    it('сверяется с полным перебором цен при разных базах, скидках, возвратах и схемах', () => {
        for (const base of [30, 100, 160, 200])
            for (const discountRate of [0, 0.17])
                for (const returnRate of [0, 0.25, 1]) {
                    const i = input({ base, discountRate, returnRate });
                    const result = calculateOzonPrices(i);
                    const target = Math.max(20, base * 0.2);
                    let first = 1;
                    while (evaluateOzonPrice(i, first * (1 - discountRate)).profit < target && first < 3000) first++;
                    expect(result.min.price).toBe(first);
                }
    });
    it('нет искусственного ограничения цены 100000 для больших фасовок', () => {
        const i = input({ base: 190000 });
        expect(calculateOzonPrices(i).min.price).toBeGreaterThan(100000);
    });
    it.each([6, 11, 0])(
        'каждая найденная цена достаточна, а рубль ниже в её ступени недостаточен, налог %s',
        (taxPercent) => {
            const i = input({ taxPercent });
            for (const level of Object.values(calculateOzonPrices(i)).filter((v: any) => v?.targetProfit) as any[]) {
                expect(evaluateOzonPrice(i, level.price).profit).toBeGreaterThanOrEqual(level.targetProfit);
                const before = evaluateOzonPrice(i, level.price - 1);
                if (before.commissionBand.min === level.commissionBand.min)
                    expect(before.profit).toBeLessThan(level.targetProfit);
            }
        },
    );
    it('ОСНО использует ту же модель, что существующий расчёт остальных площадок', () => {
        const i = input({ taxPercent: 0 });
        const p = { ...priceable(i), ozon: undefined, sales_percent: 20, fbs_direct_flow_trans_max_amount: 20 };
        const old = calculateOSNODetails(250, p, { ...coeffs, taxUnit: 0, percEkv: 0, percMil: 0 });
        expect(evaluateOzonPrice(i, 250).profit).toBeCloseTo(old.profitBeforeTax - old.profitTax - old.vatToPay, 10);
    });
    it.each([
        { base: 0 },
        { base: NaN },
        { baseSource: 'none' },
        { schemes: [] },
        { returnRate: 1.1 },
        { discountRate: 1 },
        { packing: -1 },
        { acquiringRate: NaN },
    ])('отклоняет неполные/некорректные данные %j', (override) => {
        expect(() => calculateOzonPrices(input(override as any))).toThrow();
    });
    it('отсутствующий, пересекающийся или разорванный тариф не превращается в бесплатный', () => {
        const i = input();
        i.schemes[0].commissions = [];
        expect(() => calculateOzonPrices(i)).toThrow('Нет');
        i.schemes[0].commissions = [
            { ...low, rate: 0.2 },
            { ...low, rate: 0.2 },
        ];
        expect(() => calculateOzonPrices(i)).toThrow('Пересекаются');
        i.schemes[0].commissions = [{ ...high, rate: 0.2 }];
        expect(() => evaluateOzonPrice(i, 200)).toThrow('Нет тарифа');
        expect(calculateOzonPrices(i).min.price).toBeGreaterThan(300);
    });
    it('расходы >= выручки дают отказ, не Infinity и не зависание', () => {
        expect(() => calculateOzonPrices(input({ advertisingPercent: 100 }))).toThrow('Нет допустимой');
    });
    it('обычная и максимальная цены не ниже минимальной даже при перепутанных наценках', () => {
        const r = calculateOzonPrices(input({ markups: { min: 80, normal: 10, max: 0 } }));
        expect(r.normal.price).toBeGreaterThanOrEqual(r.min.price);
        expect(r.max.price).toBeGreaterThanOrEqual(r.normal.price);
    });
    it('общий контракт использует базу своей фасовки и данные Ozon, не старые глобальные тарифы', () => {
        const p = { ...priceable(), available_price: 120 };
        expect(ozonPricingInput(p, coeffs).base).toBe(120);
        const r = calculatePrice(p, coeffs);
        expect(calculatePay(p, coeffs, Number(r.min_price)).netProfit).toBeGreaterThanOrEqual(24);
    });
});
