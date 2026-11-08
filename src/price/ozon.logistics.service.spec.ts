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
        get: jest.fn().mockResolvedValue({
            from: 'from',
            to: 'to',
            buckets: [
                bucket,
                { ...bucket, scheme: 'fbo' },
                { ...bucket, scope: 'type', key: '8' },
                { ...bucket, scheme: 'fbo', scope: 'type', key: '8' },
            ],
        }),
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
    const info: any = { sku: '123-5', typeId: 8, volumeWeight: 0.5, fbsCount: 4, fboCount: 4 };
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
        expect(m.cache.set).toHaveBeenCalledWith('test:opt:clusters:ozon-cis', expect.any(Array), 86400000);
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
    it('нет истории или ошибка чтения — понятный отказ без API-резерва', async () => {
        const m = make();
        m.routes.get.mockResolvedValueOnce({ buckets: [] });
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow('категории');
        m.routes.get.mockRejectedValueOnce(new Error('unavailable'));
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow(
            'распределение направлений для доставки: unavailable',
        );
    });
    it('ошибка активного FBO не скрывается выбором FBS; следующий запрос восстанавливается', async () => {
        const m = make();
        m.products.fboStocks.mockRejectedValueOnce(new Error('429'));
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow('FBO');
        expect(m.cache.set).not.toHaveBeenCalled();
        expect((await m.service.quote(m.product, m.info)).fbo.bands[0].source).toBe('tariff');
    });
    it('резервирование всего остатка не подменяется API max или нулевой доставкой', async () => {
        const m = make();
        m.products.fboStocks.mockResolvedValue([
            { offer_id: '123-5', sku: 1, warehouse_id: 9, present: 5, reserved: 5 },
        ]);
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow('кластера');
    });
    it.each(['acquiring', 'lastMile', 'firstMile'])('отсутствующий расход %s не заменяется нулём', async (field) => {
        const m = make();
        if (field === 'acquiring') delete m.product.acquiring;
        else
            delete m.product.commissions[
                {
                    lastMile: 'fbs_deliv_to_customer_amount',
                    firstMile: 'fbs_first_mile_max_amount',
                }[field]
            ];
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow('Нет');
    });
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

describe('Пакетная подготовка FBO', () => {
    it('несколько товаров загружаются одним вызовом, quote использует прежний кеш', async () => {
        const m = make();
        const second = { ...m.info, sku: 'other' };
        m.products.fboStocks.mockResolvedValue([
            { offer_id: m.info.sku, sku: 1, warehouse_id: 9, present: 5, reserved: 1 },
            { offer_id: 'other', sku: 2, warehouse_id: 9, present: 1, reserved: 0 },
        ]);
        await m.service.prepare([m.info, second]);
        await m.service.quote(m.product, m.info);
        await m.service.quote({ ...m.product, offer_id: 'other' }, second);
        expect(m.products.fboStocks).toHaveBeenCalledTimes(1);
        expect(m.products.fboStocks).toHaveBeenCalledWith([m.info.sku, 'other']);
        await m.service.prepare([m.info, second]);
        expect(m.products.fboStocks).toHaveBeenCalledTimes(1);
    });
    it('отказ пачки не создаёт повторного запроса на каждый товар и не выдумывает тариф', async () => {
        const m = make();
        m.products.fboStocks.mockRejectedValue(new Error('429'));
        await m.service.prepare([m.info, { ...m.info, sku: 'other' }]);
        await expect(m.service.quote(m.product, m.info)).rejects.toThrow('429');
        expect(m.products.fboStocks).toHaveBeenCalledTimes(1);
    });
});

it.each([undefined, null, ''])(
    'неизвестный обратный тариф %s сохраняется неизвестным без предупреждения',
    async (value) => {
        const m = make();
        m.product.commissions.fbs_return_flow_amount = value;
        const warning = jest.spyOn(m.service as any, 'warn');
        const result = await m.service.quote(m.product, m.info);
        expect(result.fbs.returnFlow).toBeNull();
        expect(result.fbs.bands[0].amount).toBe(20);
        expect(warning).not.toHaveBeenCalled();
    },
);
it.each([NaN, Infinity, -1])('повреждённый обратный тариф %s не считается отсутствующим', async (value) => {
    const m = make();
    m.product.commissions.fbs_return_flow_amount = value;
    await expect(m.service.quote(m.product, m.info)).rejects.toThrow('Некорректный');
});

it('при отсутствии своей истории берёт среднюю своей категории и предупреждает', async () => {
    const m = make();
    const buckets = ['fbs', 'fbo'].map((scheme) => ({
        scheme,
        scope: 'type',
        key: '8',
        units: 4,
        destinations: [
            { cluster: 'Москва', units: 3 },
            { cluster: 'Казань', units: 1 },
        ],
    }));
    m.routes.get.mockResolvedValue({ from: 'from', to: 'to', buckets });
    m.tariffs.logistics.mockResolvedValue({
        loaded: true,
        revision: 'v1',
        rows: [...m.rows, ...m.rows.map((r) => ({ ...r, destination: 'Казань', amount: r.amount * 2 }))],
    });
    const warning = jest.spyOn(m.service as any, 'warn');
    const result = await m.service.quote(m.product, m.info);
    expect(result.fbs.bands.map((b) => b.amount)).toEqual([25, 125]);
    expect(result.fbs).toMatchObject({ historySource: 'type', firstMile: 10, lastMile: 25 });
    expect(result.fbs.bands[0]).toMatchObject({
        source: 'category-average',
        warning: 'Использована средняя доставка по категории',
    });
    expect(warning).toHaveBeenCalledWith('Использована средняя доставка по категории', '123-5/fbs');
});
it('без своей истории и категории не выдаёт min/max API за доставку', async () => {
    const m = make();
    m.routes.get.mockResolvedValue({ from: 'from', to: 'to', buckets: [] });
    await expect(m.service.quote(m.product, m.info)).rejects.toThrow('категории');
});

it('неактивная FBS-схема не мешает расчёту активной FBO', async () => {
    const m = make();
    m.info.fbsCount = 0;
    const snapshot = await m.routes.get();
    m.routes.get.mockResolvedValue({ ...snapshot, buckets: snapshot.buckets.filter((b) => b.scheme === 'fbo') });
    const result = await m.service.quote(m.product, m.info);
    expect(result.fbs).toBeUndefined();
    expect(result.fbo.bands[0].amount).toBe(20);
});
it('известная доставка из XLSX не требует min/max API', async () => {
    const m = make();
    for (const scheme of ['fbs', 'fbo']) {
        delete m.product.commissions[`${scheme}_direct_flow_trans_min_amount`];
        delete m.product.commissions[`${scheme}_direct_flow_trans_max_amount`];
    }
    const result = await m.service.quote(m.product, m.info);
    expect(result.fbs.bands.map((b) => b.amount)).toEqual([20, 100]);
});

it('средняя FBO учитывает собственные склады с остатком и не требует неактивную FBS', async () => {
    const m = make();
    m.info.fbsCount = 0;
    m.routes.get.mockResolvedValue({
        from: 'from',
        to: 'to',
        buckets: [
            {
                scheme: 'fbo',
                scope: 'type',
                key: '8',
                units: 4,
                destinations: [{ cluster: 'Москва', units: 4 }],
            },
        ],
    });
    m.products.fboStocks.mockResolvedValue([
        { offer_id: '123-5', sku: 1, warehouse_id: 9, present: 3, reserved: 0 },
        { offer_id: '123-5', sku: 1, warehouse_id: 10, present: 1, reserved: 0 },
    ]);
    m.products.ozonClusters.mockResolvedValue([
        { name: 'Новосибирск', logistic_clusters: [{ warehouses: [{ warehouse_id: 9 }] }] },
        { name: 'Санкт-Петербург', logistic_clusters: [{ warehouses: [{ warehouse_id: 10 }] }] },
    ]);
    m.tariffs.logistics.mockResolvedValue({
        loaded: true,
        revision: 'v1',
        rows: [...m.rows, ...m.rows.map((r) => ({ ...r, origin: 'Санкт-Петербург', amount: r.amount * 2 }))],
    });
    const quote = await m.service.quote(m.product, m.info);
    expect(quote.fbs).toBeUndefined();
    expect(quote.fbo.bands.map((b) => b.amount)).toEqual([25, 125]);
    expect(quote.fbo).toMatchObject({ firstMile: 0, lastMile: 25, historySource: 'type' });
});
