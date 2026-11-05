import { OzonRoutesService } from './ozon.routes.service';
import { PostingService } from '../posting/posting.service';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { cronConfig } from '../cron.setup.provider/cron.setup';

const now = new Date('2026-11-05T10:00:00Z');
const posting = {
    posting_number: 'p',
    status: 'delivered',
    in_process_at: '2026-11-01T00:00:00Z',
    financial_data: { cluster_to: 'Москва' },
    products: [{ offer_id: '1-10', quantity: 3 }],
};
const make = (database = 'opt', env = 'development', services: string | string[] = ['ozon']) => {
    const data = new Map<string, any>();
    const cache = {
        get: jest.fn(async (key) => data.get(key)),
        set: jest.fn(async (key, value, ttl) => {
            data.set(key, value);
        }),
    };
    const config = {
        get: (key, fallback) =>
            ({ FB_HOST: 'local', FB_BASE: database, NODE_ENV: env, SERVICES: services })[key] ?? fallback,
    };
    const fbs = { listForLogistics: jest.fn().mockResolvedValue([posting]) };
    const fbo = { listForLogistics: jest.fn().mockResolvedValue([]) };
    const products = {
        listAllOfferIds: jest.fn().mockResolvedValue(['1-10']),
        infoList: jest.fn().mockResolvedValue([{ sku: '1-10', typeId: 8 }]),
    };
    const service = new OzonRoutesService(config as any, cache as any, fbs as any, fbo as any, products as any);
    return { service, data, cache, fbs, fbo, products };
};

describe('Суточное распределение направлений', () => {
    it('один снимок на кабинет; повторное чтение не обращается к API', async () => {
        const m = make();
        const snapshot = await m.service.get(now);
        expect(snapshot).toMatchObject({ from: '2026-08-07T00:00:00.000+03:00', to: '2026-11-05T00:00:00.000+03:00' });
        expect(snapshot.buckets.find((b) => b.scope === 'offer')).toMatchObject({ units: 3 });
        expect(await m.service.get(now)).toEqual(snapshot);
        expect(m.fbs.listForLogistics).toHaveBeenCalledTimes(1);
        expect(m.fbs.listForLogistics).toHaveBeenCalledWith(new Date(snapshot.from), new Date(snapshot.to));
        expect(m.cache.set).toHaveBeenCalledWith(m.service.cacheKey, snapshot, 172800000);
        expect(make('magazin').service.cacheKey).not.toBe(m.service.cacheKey);
    });
    it('полночь Москвы запускает обновление, даже если TTL ещё не истёк', async () => {
        const m = make();
        await m.service.get(new Date('2026-11-05T20:59:59Z'));
        const next = await m.service.get(new Date('2026-11-05T21:00:00Z'));
        expect(next.to).toBe('2026-11-06T00:00:00.000+03:00');
        expect(m.fbs.listForLogistics).toHaveBeenCalledTimes(2);
    });
    it('параллельные запросы делят одну загрузку', async () => {
        const m = make();
        const snapshots = await Promise.all([m.service.refresh(now), m.service.get(now), m.service.refresh(now)]);
        expect(snapshots[0]).toEqual(snapshots[1]);
        expect(m.fbs.listForLogistics).toHaveBeenCalledTimes(1);
        expect(m.cache.set).toHaveBeenCalledTimes(1);
    });
    it('запрос после полуночи дожидается прошлого обновления и строит новый снимок', async () => {
        const m = make();
        const [old, next] = await Promise.all([
            m.service.refresh(new Date('2026-11-05T20:59:59Z')),
            m.service.refresh(new Date('2026-11-05T21:00:00Z')),
        ]);
        expect(old.to).toBe('2026-11-05T00:00:00.000+03:00');
        expect(next.to).toBe('2026-11-06T00:00:00.000+03:00');
        expect(m.data.get(m.service.cacheKey)).toBe(next);
    });
    it('ошибка FBO не сохраняет частичный FBS; повторный запуск возможен', async () => {
        const m = make();
        const old = await m.service.refresh(now);
        m.cache.set.mockClear();
        m.fbo.listForLogistics.mockRejectedValueOnce(new Error('429'));
        await expect(m.service.refresh(now)).rejects.toThrow('429');
        expect(m.cache.set).not.toHaveBeenCalled();
        expect(m.data.get(m.service.cacheKey)).toBe(old);
        await expect(m.service.refresh(now)).resolves.toEqual(old);
    });
    it.each([[], [{ sku: 'other' }], [{ sku: '1-10' }, { sku: '1-10' }]].map((catalog) => [catalog]))(
        'неполный каталог не затирает снимок: %j',
        async (catalog) => {
            const m = make();
            m.products.infoList.mockResolvedValue(catalog);
            await expect(m.service.refresh(now)).rejects.toThrow('каталог');
            expect(m.cache.set).not.toHaveBeenCalled();
            expect(m.fbs.listForLogistics).not.toHaveBeenCalled();
        },
    );
    it('пустой каталог отклоняется, пустая история корректна', async () => {
        const m = make();
        m.products.listAllOfferIds.mockResolvedValueOnce([]);
        await expect(m.service.refresh(now)).rejects.toThrow('Пустой каталог');
        m.fbs.listForLogistics.mockResolvedValue([]);
        expect((await m.service.refresh(now)).buckets).toEqual([]);
        expect((await m.service.get(now)).buckets).toEqual([]);
        expect(m.fbs.listForLogistics).toHaveBeenCalledTimes(1);
    });
    it('битый снимок пересчитывается; ошибка Redis не выдаётся за сохранение', async () => {
        const m = make();
        const good = await m.service.refresh(now);
        m.data.set(m.service.cacheKey, { ...good, buckets: [{ ...good.buckets[0], units: 999 }] });
        await m.service.get(now);
        expect(m.fbs.listForLogistics).toHaveBeenCalledTimes(2);
        m.cache.set.mockRejectedValueOnce(new Error('Redis unavailable'));
        await expect(m.service.refresh(now)).rejects.toThrow('Redis unavailable');
        await expect(m.service.refresh(now)).resolves.toEqual(good);
    });
    it('ежедневная задача работает только для production/ozon', async () => {
        for (const [env, services, calls] of [
            ['development', ['ozon'], 0],
            ['production', ['wb'], 0],
            ['production', 'wb,ozon', 1],
        ] as const) {
            const m = make('opt', env, services as any);
            const refresh = jest.spyOn(m.service, 'refresh').mockResolvedValue({} as any);
            await m.service.daily();
            expect(refresh).toHaveBeenCalledTimes(calls);
        }
        expect(cronConfig.ozonLogisticsRoutes).toEqual({ production: true, development: false });
    });
});

describe.each(['fbs', 'fbo'])('Существующий загрузчик %s для логистики', (scheme) => {
    const makeReader = () => {
        const read = jest.fn();
        const service: any = Object.create(scheme === 'fbs' ? PostingService.prototype : PostingFboService.prototype);
        service.productService = { orderList: read, orderFboList: read };
        // Обращение к журналу и создание документов в этом пути недопустимы.
        service.mpEvent = {
            record: jest.fn(() => {
                throw new Error('journal write');
            }),
            windowStart: jest.fn(() => {
                throw new Error('journal window');
            }),
        };
        return { service, read };
    };
    const since = new Date('2026-08-07T00:00:00Z'),
        to = new Date('2026-11-05T00:00:00Z');
    it('читает все страницы с финансовыми полями без журнала', async () => {
        const { service, read } = makeReader();
        read.mockResolvedValueOnce({ postings: [posting], cursor: 'next', has_next: true }).mockResolvedValueOnce({
            postings: [{ ...posting, posting_number: 'p2' }],
            has_next: false,
        });
        expect(await service.listForLogistics(since, to)).toHaveLength(2);
        if (scheme === 'fbs')
            expect(read).toHaveBeenLastCalledWith({ since, to, statuses: ['delivered'] }, 100, 'next', true);
        else
            expect(read).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    cursor: 'next',
                    filter: { since, to, statuses: ['delivered'] },
                    with: { analytics_data: true, financial_data: true },
                }),
            );
        expect(service.mpEvent.record).not.toHaveBeenCalled();
        expect(service.mpEvent.windowStart).not.toHaveBeenCalled();
    });
    it.each([
        {},
        { postings: [], has_next: true },
        { postings: [], has_next: 'false' },
        { postings: [], has_next: true, cursor: 'same' },
    ])('отклоняет неполную страницу/зацикленный курсор %j', async (response) => {
        const { service, read } = makeReader();
        read.mockResolvedValue(response);
        await expect(service.listForLogistics(since, to)).rejects.toThrow();
        expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    });
});
