import { OzonLogisticsService } from './ozon.logistics.service';

const make = () => {
    const bands = [
        { min: 0, max: 300, minIncluded: true, maxIncluded: true },
        { min: 300, max: null, minIncluded: false, maxIncluded: true },
    ];
    const rows = bands.map((band, i) => ({
        band,
        origin: 'Новосибирск',
        destination: 'Москва',
        amount: i ? 100 : 20,
        isDefault: false,
    }));
    const bucket = {
        scheme: 'fbs',
        scope: 'offer',
        key: '123-5',
        units: 4,
        destinations: [{ cluster: 'Москва', units: 4 }],
    };
    const routes = {
        cacheKey: 'test:opt',
        get: jest.fn().mockResolvedValue({ from: 'from', to: 'to', buckets: [bucket, { ...bucket, scheme: 'fbo' }] }),
    };
    const tariffs = { logistics: jest.fn().mockResolvedValue({ loaded: true, revision: 'v1', rows }) };
    const products = {
        fboStocks: jest
            .fn()
            .mockResolvedValue([{ offer_id: '123-5', sku: 1, warehouse_id: 9, present: 5, reserved: 1 }]),
        ozonClusters: jest
            .fn()
            .mockResolvedValue([{ name: 'Новосибирск', logistic_clusters: [{ warehouses: [{ warehouse_id: 9 }] }] }]),
    };
    const data = new Map();
    const cache = {
        get: jest.fn(async (key) => data.get(key)),
        set: jest.fn(async (key, value, ttl) => {
            data.set(key, value);
        }),
    };
    const config = { get: jest.fn((key, fallback) => fallback) };
    const service = new OzonLogisticsService(
        routes as any,
        tariffs as any,
        products as any,
        cache as any,
        config as any,
    );
    const product: any = {
        offer_id: '123-5',
        volume_weight: 0.9,
        acquiring: 5,
        price: { price: '500' },
        commissions: {},
    };
    for (const scheme of ['fbs', 'fbo'])
        Object.assign(product.commissions, {
            [scheme + '_direct_flow_trans_min_amount']: 40,
            [scheme + '_direct_flow_trans_max_amount']: 200,
            [scheme + '_deliv_to_customer_amount']: 25,
            [scheme + '_return_flow_amount']: 80,
        });
    product.commissions.fbs_first_mile_max_amount = 10;
    const info: any = { sku: '123-5', typeId: 8, volumeWeight: 0.5, fboCount: 4 };
    return { service, routes, tariffs, products, cache, data, config, product, info, rows };
};
describe('Расходы Ozon для единого расчёта цены', () => {
    it('возвращает обе ступени и расходы каждой схемы, без умножения на фасовку', async () => {
        const m = make();
        const result = await m.service.quote(m.product, m.info);
        expect(result.fbs.bands.map((b) => b.amount)).toEqual([20, 100]);
        expect(result.fbo.bands.map((b) => b.amount)).toEqual([20, 100]);
        expect(result.fbs).toMatchObject({ firstMile: 10, lastMile: 25, returnFlow: 80, historySource: 'offer' });
        expect(result.fbo.firstMile).toBe(0);
        expect(result).toMatchObject({
            acquiringRate: 0.01,
            acquiringAmount: 5,
            acquiringReferencePrice: 500,
            tariffRevision: 'v1',
            historyFrom: 'from',
            historyTo: 'to',
        });
        expect(m.tariffs.logistics).toHaveBeenCalledWith(0.5);
    });
    it('остатки на 5 минут, кластеры на сутки; параллельные расчёты не дублируют запросы', async () => {
        const m = make();
        await Promise.all([m.service.quote(m.product, m.info), m.service.quote(m.product, m.info)]);
        await m.service.quote(m.product, m.info);
        expect(m.products.fboStocks).toHaveBeenCalledTimes(1);
        expect(m.products.ozonClusters).toHaveBeenCalledTimes(1);
        expect(m.cache.set).toHaveBeenCalledWith('test:opt:stocks:123-5', expect.any(Array), 300000);
        expect(m.cache.set).toHaveBeenCalledWith('test:opt:clusters', expect.any(Array), 86400000);
    });
    it('новый тариф применяется при прежнем распределении и остатках', async () => {
        const m = make();
        await m.service.quote(m.product, m.info);
        m.tariffs.logistics.mockResolvedValue({
            loaded: true,
            revision: 'v2',
            rows: m.rows.map((r) => ({ ...r, amount: r.amount * 2 })),
        });
        const result = await m.service.quote(m.product, m.info);
        expect(result.fbo.bands.map((b) => b.amount)).toEqual([40, 200]);
        expect(result.tariffRevision).toBe('v2');
        expect(m.products.fboStocks).toHaveBeenCalledTimes(1);
    });
    it('без остатка FBO не запрашивает склады', async () => {
        const m = make();
        m.info.fboCount = 0;
        m.info.volumeWeight = undefined;
        expect((await m.service.quote(m.product, m.info)).fbo).toBeUndefined();
        expect(m.products.fboStocks).not.toHaveBeenCalled();
        expect(m.tariffs.logistics).toHaveBeenCalledWith(0.9);
    });
    it('нет истории — среднее API; ошибка истории — максимум с предупреждением', async () => {
        const m = make();
        m.routes.get.mockResolvedValueOnce({ buckets: [] });
        expect((await m.service.quote(m.product, m.info)).fbs.bands[0]).toMatchObject({
            amount: 120,
            source: 'api-average',
        });
        m.routes.get.mockRejectedValueOnce(new Error('unavailable'));
        expect((await m.service.quote(m.product, m.info)).fbs.bands[0]).toMatchObject({
            amount: 200,
            source: 'api-max',
            warning: expect.any(String),
        });
    });
    it('ошибка складов FBO не меняет FBS и не кэшируется; следующий запрос восстанавливается', async () => {
        const m = make();
        m.products.fboStocks.mockRejectedValueOnce(new Error('429'));
        const result = await m.service.quote(m.product, m.info);
        expect(result.fbs.bands[0].amount).toBe(20);
        expect(result.fbo.bands[0]).toMatchObject({ amount: 200, source: 'api-max' });
        expect(m.cache.set).not.toHaveBeenCalled();
        expect((await m.service.quote(m.product, m.info)).fbo.bands[0].source).toBe('tariff');
    });
    it('резервирование всего остатка приводит к API max, не к нулевой доставке', async () => {
        const m = make();
        m.products.fboStocks.mockResolvedValue([
            { offer_id: '123-5', sku: 1, warehouse_id: 9, present: 5, reserved: 5 },
        ]);
        expect((await m.service.quote(m.product, m.info)).fbo.bands[0].amount).toBe(200);
    });
    it.each(['acquiring', 'lastMile', 'firstMile', 'returnFlow'])(
        'отсутствующий расход %s не заменяется нулём',
        async (field) => {
            const m = make();
            if (field === 'acquiring') delete m.product.acquiring;
            else
                delete m.product.commissions[
                    {
                        lastMile: 'fbs_deliv_to_customer_amount',
                        firstMile: 'fbs_first_mile_max_amount',
                        returnFlow: 'fbs_return_flow_amount',
                    }[field]
                ];
            await expect(m.service.quote(m.product, m.info)).rejects.toThrow('Нет');
        },
    );
    it('отклоняет чужой артикул, неверный порог и положительный эквайринг без цены', async () => {
        const m = make();
        await expect(m.service.quote(m.product, { ...m.info, sku: 'other' })).rejects.toThrow('Артикул');
        m.config.get.mockReturnValueOnce(0);
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow('MIN_UNITS');
        m.product.price.price = 0;
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow('положительной цены');
        m.product.acquiring = 0;
        expect((await m.service.quote(m.product, m.info)).acquiringRate).toBe(0);
    });
});
