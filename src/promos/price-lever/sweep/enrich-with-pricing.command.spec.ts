import { ConfigService } from '@nestjs/config';
import { emptyProgress } from '../../../interfaces/i.job.context';
import { EnrichWithPricingCommand } from './enrich-with-pricing.command';
import { CollectSweepCommand } from './collect-sweep.command';
import { PlanSweepCommand } from './plan-sweep.command';
import { ApplySweepCommand } from './apply-sweep.command';
import { BuildSweepReportCommand } from './build-sweep-report.command';
import { IPromoSweepContext } from './promo-sweep.context';
import { PromoPriceState } from '../promo-price.types';

const state = (offerId = '123-5'): PromoPriceState => ({
    offerId,
    productId: 1,
    oldPrice: 900,
    price: 800,
    minPrice: 150,
    buyerPrice: 150,
    buyerPriceCalc: 150,
    seller: null,
    ozonActions: [],
});
const context = (states = [state()]): IPromoSweepContext => ({
    apply: false,
    goal: 'min',
    progress: emptyProgress(),
    states,
});
const make = () => {
    const low = { min: 0, max: 300, minIncluded: true, maxIncluded: true };
    const high = { min: 300, max: null, minIncluded: false, maxIncluded: true };
    const ozon = {
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
    const pricing = { prepare: jest.fn().mockResolvedValue(undefined), load: jest.fn().mockResolvedValue(ozon) };
    const products = {
        getPrices: jest
            .fn()
            .mockImplementation(async ({ offer_id }) => ({ items: offer_id.map((offer_id) => ({ offer_id })) })),
        infoList: jest.fn().mockImplementation(async (offers) => offers.map((sku) => ({ sku, typeId: 1 }))),
    };
    const row = {
        offer_id: '123',
        pieces: 5,
        min_perc: 20,
        perc: 40,
        old_perc: 80,
        adv_perc: 0,
        packing_price: 0,
        available_price: 0,
        return_perc: 0,
    };
    const goods = {
        prices: jest.fn().mockResolvedValue([{ code: 123, price: 20, free_stock: 10, base_source: 'remaining-lots' }]),
        getPerc: jest.fn().mockResolvedValue([row]),
        generatePercentsForService: jest.fn().mockResolvedValue([row]),
    };
    const command = new EnrichWithPricingCommand(
        pricing as any,
        products as any,
        goods as any,
        new ConfigService({ SUM_LABEL: 0, SUM_OBTAIN: 0, SUM_PACK: 0, TAX_UNIT: 10 }),
    );
    return { command, pricing, products, goods, row, ozon };
};
describe('Обогащение сверки единым расчётом', () => {
    it('без карточки увеличивает noBase, очищает старые значения и не вызывает расчёт', async () => {
        const m = make();
        m.products.infoList.mockResolvedValue([]);
        const s = { ...state(), calcMinPrice: 1, deadZoneFloor: 2 };
        const ctx = context([s]);
        ctx.progress.counters.noBase = 3;
        await m.command.execute(ctx);
        expect(s.calcMinPrice).toBeUndefined();
        expect(s.deadZoneFloor).toBeUndefined();
        expect(ctx.progress.counters.noBase).toBe(4);
        expect(m.pricing.load).not.toHaveBeenCalled();
    });
    it('с базой использует общую формулу: 200 минимум, 550 граница верхней ступени', async () => {
        const m = make();
        const s = state();
        const ctx = context([s]);
        await m.command.execute(ctx);
        expect(s.calcMinPrice).toBe(200);
        expect(s.deadZoneFloor).toBe(550);
        expect(m.goods.getPerc).toHaveBeenCalledWith(['123'], null);
        expect(ctx.progress).toMatchObject({ done: 1, total: 1, counters: { noBase: 0 } });
    });
    it('рыночная цена своей пачки имеет приоритет и не умножается повторно на 5', async () => {
        const m = make();
        m.goods.getPerc.mockResolvedValue([
            { ...m.row, available_price: 115 },
            { ...m.row, pieces: 1, available_price: 9999 },
        ]);
        const s = state();
        await m.command.execute(context([s]));
        expect(s.calcMinPrice).toBe(226);
    });
    it('использует автоматический процент возвратов', async () => {
        const m = make();
        m.goods.getPerc.mockResolvedValue([{ ...m.row, return_perc: 0.25 }]);
        const s = state();
        await m.command.execute(context([s]));
        expect(s.calcMinPrice).toBe(229);
        expect(s.deadZoneFloor).toBe(650);
    });
    it('отсутствующие наценки подбираются существующим сборщиком без записи', async () => {
        const m = make();
        m.goods.getPerc.mockResolvedValue([]);
        const s = state();
        await m.command.execute(context([s]));
        expect(m.goods.generatePercentsForService).toHaveBeenCalledWith(
            null,
            ['123-5'],
            undefined,
            expect.objectContaining({ goods: expect.any(Array), percents: expect.any(Array) }),
        );
        expect(s.calcMinPrice).toBe(200);
    });
    it.each(['base', 'tariff', 'price'])(
        'ошибка %s учитывается по товару, следующий товар проверяется',
        async (failure) => {
            const m = make();
            const a = state(),
                b = state('124-5');
            m.goods.prices.mockResolvedValue([
                { code: 123, price: failure === 'base' ? null : 20, free_stock: 10 },
                { code: 124, price: 20, free_stock: 10 },
            ]);
            m.goods.getPerc.mockResolvedValue([m.row, { ...m.row, offer_id: '124' }]);
            if (failure === 'tariff') m.pricing.load.mockRejectedValueOnce(new Error('нет тарифа'));
            if (failure === 'price') m.products.getPrices.mockResolvedValue({ items: [{ offer_id: '124-5' }] });
            const ctx = context([a, b]);
            await m.command.execute(ctx);
            expect(a.calcMinPrice).toBeUndefined();
            expect(b.calcMinPrice).toBe(200);
            expect(ctx.progress.counters.noBase).toBe(1);
        },
    );
    it('одна ступень не создаёт выдуманную мёртвую зону', async () => {
        const m = make();
        m.ozon.schemes[0].commissions = [{ ...m.ozon.schemes[0].commissions[0], max: null }];
        m.ozon.schemes[0].logistics = [{ ...m.ozon.schemes[0].logistics[0], max: null }];
        const s = state();
        await m.command.execute(context([s]));
        expect(s.calcMinPrice).toBe(200);
        expect(s.deadZoneFloor).toBeUndefined();
    });
    it('товар вне акций с ценой ровно по старому минимуму всё равно обогащается и попадает в план', async () => {
        const m = make();
        const s = state();
        const ctx = context([]);
        await new CollectSweepCommand({ allStates: async () => [s] } as any).execute(ctx);
        expect(ctx.states).toEqual([]); // предварительный отбор по старому min_price
        await m.command.execute(ctx);
        await new PlanSweepCommand().execute(ctx);
        expect(ctx.states).toEqual([s]);
        expect(ctx.plans).toHaveLength(1);
        expect(ctx.plans[0].target).toBe(200);
        expect(ctx.checked).toBe(1);
    });
    it('после расчёта актуальная минимальная цена отбирает below-min', async () => {
        const m = make();
        const s = { ...state(), minPrice: 100, buyerPrice: 180 };
        const ctx = { ...context([s]), goal: 'below-min' as const };
        await m.command.execute(ctx);
        expect(ctx.states).toEqual([s]);
    });
    it('ошибка расчёта попадает в отчёт без действий, даже при apply=true', async () => {
        const m = make();
        m.pricing.load.mockRejectedValue(new Error('нет тарифа'));
        const ctx = { ...context(), apply: true };
        const apply = jest.fn();
        await m.command.execute(ctx);
        await new PlanSweepCommand().execute(ctx);
        await new ApplySweepCommand({ apply } as any).execute(ctx);
        await new BuildSweepReportCommand().execute(ctx);
        expect(apply).not.toHaveBeenCalled();
        expect(ctx.report.unfixable).toBe(1);
        expect(ctx.report.items[0]).toMatchObject({ ok: false, steps: [], notes: ['Расчёт недоступен: нет тарифа'] });
    });
    it('dry run не вызывает applier даже при готовом плане изменения акции', async () => {
        const m = make();
        const s = {
            ...state(),
            seller: { actionId: 1, title: 'sale', sku: 99, percent: 5, minPercent: 5, isActive: true },
        };
        const ctx = context([s]);
        const apply = jest.fn();
        await m.command.execute(ctx);
        await new PlanSweepCommand().execute(ctx);
        expect(ctx.plans[0].steps.length).toBeGreaterThan(0);
        await new ApplySweepCommand({ apply } as any).execute(ctx);
        expect(apply).not.toHaveBeenCalled();
    });
    it('пустой список и остановленная задача не загружают данные', async () => {
        const m = make();
        await m.command.execute(context([]));
        await m.command.execute({ ...context(), stopChain: true });
        expect(m.products.getPrices).not.toHaveBeenCalled();
    });
    it('ошибка общей загрузки даёт счётчик на каждую строку', async () => {
        const m = make();
        m.products.infoList.mockRejectedValue(new Error('429'));
        const ctx = context([state(), state('124-5')]);
        await m.command.execute(ctx);
        expect(ctx.progress.counters.noBase).toBe(2);
        expect(ctx.progress.done).toBe(2);
    });
});

it('неизвестные дополнительные расходы не исключают товар из сверки акций', async () => {
    const m = make();
    const statistics = {
        defectRate: null,
        cancellationDelivery: null,
        sellerReturnDelivery: null,
        confirmedDefectCompensation: 0,
    };
    Object.assign(m.ozon, { lossStatistics: statistics });
    const ctx = context();
    await m.command.execute(ctx);
    expect(ctx.progress.counters.noBase).toBe(0);
    expect(ctx.pricingErrors.size).toBe(0);
    expect(ctx.states[0].calcMinPrice).toBe(200);
    expect(statistics.defectRate).toBeNull();
});

it('кеш расчёта не заменяет свежую цену и акции, ошибка чтения не скрывается старой ценой', async () => {
    const { OzonCalculationCacheService } = await import('../../../price/ozon-calculation-cache.service');
    const memory = new Map();
    const cache = {
        get: async (key) => memory.get(key),
        set: async (key, value) => {
            memory.set(key, value);
        },
    };
    const m = make();
    (m.command as any).calculations = new OzonCalculationCacheService(cache as any, new ConfigService());
    const first = context([state()]);
    await m.command.execute(first);
    const second = context([{ ...state(), buyerPrice: 250, buyerPriceCalc: 250 }]);
    await m.command.execute(second);
    expect(second.progress.counters.calculationCacheHit).toBe(1);
    expect(m.products.infoList).toHaveBeenCalledTimes(2);
    expect(m.pricing.load).toHaveBeenCalledTimes(2);
    await new PlanSweepCommand().execute(second);
    expect(second.plans[0].buyerBefore).toBe(250);
    m.products.infoList.mockRejectedValueOnce(Error('API 503'));
    const failed = context([state()]);
    await m.command.execute(failed);
    expect(failed.pricingErrors.get('123-5')).toBe('API 503');
    expect(failed.states[0].calcMinPrice).toBeUndefined();
});
