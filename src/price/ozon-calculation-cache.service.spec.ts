import { ConfigService } from '@nestjs/config';
import { OzonCalculationCacheService } from './ozon-calculation-cache.service';
import * as formula from '../helpers/price/ozon.pricing';
const input = (): formula.OzonPricingInput => ({
    base: 100,
    baseSource: 'remaining-lots',
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
                { min: 0, max: 300, minIncluded: true, maxIncluded: true, rate: 0.2 },
                { min: 300, max: null, minIncluded: false, maxIncluded: false, rate: 0.5 },
            ],
            logistics: [
                { min: 0, max: 300, minIncluded: true, maxIncluded: true, amount: 20 },
                { min: 300, max: null, minIncluded: false, maxIncluded: false, amount: 100 },
            ],
            lastMile: 0,
            firstMile: 0,
            returnFlow: 60,
        },
    ],
});
const dependencies = () => ({
    product: { price: 1000 },
    info: { fbsCount: 2, fboCount: 0, volumeWeight: 1, typeId: 1 },
    pieces: 1,
    goods: { price: 100 },
});
function setup() {
    const values = new Map<string, any>();
    const cache = {
        get: jest.fn(async (key) => structuredClone(values.get(key))),
        set: jest.fn(async (key, value, _ttl) => {
            values.set(key, structuredClone(value));
        }),
    };
    const service = new OzonCalculationCacheService(cache as any, new ConfigService({ FB_HOST: 'db', FB_BASE: 'one' }));
    return { service, cache, values };
}
it('повтор использует прежний чистый расчёт, не вызывая формулу, и сохраняет границу ступени', async () => {
    const s = setup();
    const spy = jest.spyOn(formula, 'calculateOzonPrices');
    try {
        const first = await s.service.calculate('123', input(), dependencies());
        const next = await s.service.calculate('123', input(), dependencies());
        expect(first).toEqual({ minPrice: 200, deadZoneFloor: 550, cacheHit: false });
        expect(next).toEqual({ ...first, cacheHit: true });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(s.cache.set.mock.calls[0][2]).toBe(7200000);
    } finally {
        spy.mockRestore();
    }
});
it.each([
    ['закупка', (i) => i.base++],
    ['минимальная наценка', (i) => i.markups.min++],
    ['нормальная наценка', (i) => i.markups.normal++],
    ['реклама', (i) => i.advertisingPercent++],
    ['упаковка', (i) => i.packing++],
    ['этикетка', (i) => i.label++],
    ['внутренние расходы', (i) => i.handling++],
    ['налог', (i) => i.taxPercent++],
    ['НДС', (i) => i.vatRate++],
    ['эквайринг', (i) => (i.acquiringRate = 0.01)],
    ['серверный минимум', (i) => i.minProfitRub++],
    ['возвраты', (i) => (i.returnRate = 0.1)],
    ['доставка', (i) => i.schemes[0].logistics[0].amount++],
    ['комиссия', (i) => (i.schemes[0].commissions[0].rate = 0.21)],
    ['схема', (i) => (i.schemes[0].scheme = 'fbo')],
    ['потери', (i) => (i.lossCosts = { purchaseCost: 100, defectRate: 0.1 })],
] as [string, (input: any) => void][])('%s меняется — старый расчёт не берётся', async (_name, change) => {
    const s = setup();
    await s.service.calculate('123', input(), dependencies());
    const next = input();
    change(next);
    expect((await s.service.calculate('123', next, dependencies())).cacheHit).toBe(false);
});
it.each(['pieces', 'product', 'info', 'goods'])(
    'изменение зависимости %s сбрасывает расчёт даже при совпадении суммы входа',
    async (key) => {
        const s = setup();
        await s.service.calculate('123', input(), dependencies());
        const deps: any = dependencies();
        if (key === 'pieces') deps.pieces = 2;
        else if (key === 'info') deps.info.fbsCount++;
        else if (key === 'goods') deps.goods.price++;
        else deps.product.price++;
        expect((await s.service.calculate('123', input(), deps)).cacheHit).toBe(false);
    },
);
it('кабинеты и артикулы не разделяют сохранённый результат', async () => {
    const s = setup();
    await s.service.calculate('123', input(), dependencies());
    const other = new OzonCalculationCacheService(s.cache as any, new ConfigService({ FB_HOST: 'db', FB_BASE: 'two' }));
    expect((await other.calculate('123', input(), dependencies())).cacheHit).toBe(false);
    expect((await s.service.calculate('456', input(), dependencies())).cacheHit).toBe(false);
});
it('ошибка кеша не препятствует свежему расчёту', async () => {
    const s = setup();
    s.cache.get.mockRejectedValueOnce(Error('redis'));
    s.cache.set.mockRejectedValueOnce(Error('redis'));
    expect((await s.service.calculate('123', input(), dependencies())).minPrice).toBe(200);
});
it('некорректный вход не прячется за успешным кешем; ошибка не сохраняется', async () => {
    const s = setup();
    await s.service.calculate('123', input(), dependencies());
    await expect(s.service.calculate('123', { ...input(), base: NaN }, dependencies())).rejects.toThrow();
    expect(s.cache.set).toHaveBeenCalledTimes(1);
});
it('повреждённый кеш пересчитывается', async () => {
    const s = setup();
    await s.service.calculate('123', input(), dependencies());
    s.values.forEach((value) => (value.minPrice = NaN));
    expect((await s.service.calculate('123', input(), dependencies())).cacheHit).toBe(false);
});
