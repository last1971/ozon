import { SHOWCASE_LISTS, SyliusShowcaseService } from './sylius.showcase.service';

describe('SyliusShowcaseService — витрины сайта', () => {
    const now = new Date('2026-10-20T15:00:00');
    const inShopStock = jest.fn();
    const firstShopArrivals = jest.fn();
    const sales = jest.fn();
    const lastSupplierArrivals = jest.fn();
    const method = jest.fn();
    const config = (services: string[], env: Record<string, string> = {}) => ({
        get: jest.fn((k: string, d: any) => (k === 'SERVICES' ? services : (env[k] ?? d))),
    });
    const make = (services = ['ozon', 'sylius'], env: Record<string, string> = {}) =>
        new SyliusShowcaseService(
            config(services, env) as any,
            { inShopStock, firstShopArrivals, sales, lastSupplierArrivals } as any,
            { method } as any,
        );

    beforeEach(() => {
        [inShopStock, firstShopArrivals, sales, lastSupplierArrivals, method].forEach((m) => m.mockReset());
        lastSupplierArrivals.mockResolvedValue([
            { code: '9', lastIn: new Date('2026-10-01T09:00:00') },
            { code: '476318', lastIn: new Date('2026-10-19T09:00:00') },
        ]);
        inShopStock.mockResolvedValue(new Set(['551973', '564308', '476318', '561526', '9']));
        firstShopArrivals.mockResolvedValue([
            { code: '564308', firstIn: new Date('2026-10-12T09:00:00') },
            { code: '551973', firstIn: new Date('2026-10-14T09:00:00') },
        ]);
        sales.mockResolvedValue([
            { code: '561526', sales: 711, pieces: 753 },
            { code: '476318', sales: 1033, pieces: 5368 },
            { code: '9', sales: 1, pieces: 1 },
        ]);
        method.mockImplementation(async (_url: string, _verb: string, body: any) => ({
            list: body.list,
            received: body.codes.length,
            notFound: 1,
        }));
    });

    it('dryRun: считает new и hits, коды в ответе, в Sylius не ходит; окна от полуночи: новинки 180, хиты 90', async () => {
        const res = await make().run(true, ['new', 'hits'], now);
        expect(method).not.toHaveBeenCalled();
        expect(res.lists).toEqual([
            { list: 'new', count: 2, codes: ['551973', '564308'] },
            { list: 'hits', count: 2, codes: ['476318', '561526'] },
        ]);
        const newSince: Date = firstShopArrivals.mock.calls[0][0];
        expect(newSince.toISOString()).toBe(new Date('2026-04-23T00:00:00').toISOString());
        const hitsSince: Date = sales.mock.calls[0][0];
        expect(hitsSince.toISOString()).toBe(new Date('2026-07-22T00:00:00').toISOString());
    });

    it('боевой: по одному списку за вызов, контракт {list, codes}, итог received/notFound', async () => {
        const res = await make().run(false, ['new', 'hits'], now);
        expect(method).toHaveBeenNthCalledWith(1, '/api/v2/admin/showcase/update', 'post', {
            list: 'new',
            codes: ['551973', '564308'],
        });
        expect(method).toHaveBeenNthCalledWith(2, '/api/v2/admin/showcase/update', 'post', {
            list: 'hits',
            codes: ['476318', '561526'],
        });
        expect(res.lists).toEqual([
            { list: 'new', count: 2, received: 2, notFound: 1 },
            { list: 'hits', count: 2, received: 2, notFound: 1 },
        ]);
    });

    it('422 сайта — в итоге статус и текст сайта; ошибка одного списка не роняет другой', async () => {
        method.mockRejectedValueOnce(
            Object.assign(new Error('Request failed with status code 422'), {
                response: { status: 422, data: { detail: 'codes: не массив' } },
            }),
        );
        const res = await make().run(false, ['new', 'hits'], now);
        expect(res.lists[0]).toEqual({ list: 'new', count: 2, error: '422: codes: не массив' });
        expect(res.lists[1].received).toBe(2);
    });

    it('ручка по умолчанию шлёт все четыре; deals до расчёта цен — ошибка с подсказкой, остальные уходят', async () => {
        const res = await make().run(false, SHOWCASE_LISTS, now);
        expect(res.lists.map((l) => l.list)).toEqual(['new', 'hits', 'arrivals', 'deals']);
        expect(res.lists[3]).toEqual({
            list: 'deals',
            count: 0,
            error: expect.stringContaining('/api/price/all/sylius'),
        });
        expect(method).toHaveBeenCalledTimes(3);
        expect(res.dealsComputedAt).toBeNull();
    });

    it('только hits — новинки не читаются', async () => {
        await make().run(true, ['hits'], now);
        expect(firstShopArrivals).not.toHaveBeenCalled();
        expect(sales).toHaveBeenCalled();
    });

    it('крон шлёт new, hits и arrivals, но не deals', async () => {
        await make().scheduled();
        expect(method.mock.calls.map((c) => c[2].list)).toEqual(['new', 'hits', 'arrivals']);
    });

    it('arrivals: окно 30 дней, свежие первыми, без остатка — мимо; поставщики-«не приходы» по умолчанию', async () => {
        const res = await make().run(true, ['arrivals'], now);
        expect(res.lists).toEqual([{ list: 'arrivals', count: 2, codes: ['476318', '9'] }]);
        const [since, exclude] = lastSupplierArrivals.mock.calls[0];
        expect(since.toISOString()).toBe(new Date('2026-09-20T00:00:00').toISOString());
        expect(exclude).toEqual([1079, 1246, 2713]);
        expect(firstShopArrivals).not.toHaveBeenCalled();
        expect(sales).not.toHaveBeenCalled();
    });

    it('arrivals: коды «не приходов» из env SHOWCASE_NOT_ARRIVAL_SUPPLIERS; мусор в env — ошибка при запуске', async () => {
        await make(['sylius'], { SHOWCASE_NOT_ARRIVAL_SUPPLIERS: ' 1079, 5 ' }).run(true, ['arrivals'], now);
        expect(lastSupplierArrivals.mock.calls[0][1]).toEqual([1079, 5]);
        expect(() => make(['sylius'], { SHOWCASE_NOT_ARRIVAL_SUPPLIERS: '1079,ПП' })).toThrow('ПП');
    });

    it('parseLists: пусто — все, порядок фиксированный, неизвестный — 400', () => {
        expect(SyliusShowcaseService.parseLists(undefined)).toEqual(['new', 'hits', 'arrivals', 'deals']);
        expect(SyliusShowcaseService.parseLists(' deals, NEW, arrivals ')).toEqual(['new', 'arrivals', 'deals']);
        expect(() => SyliusShowcaseService.parseLists('new,top')).toThrow('top');
    });

    it('без sylius в SERVICES — ничего не читает и не шлёт; крон молчит', async () => {
        const svc = make(['ozon', 'wb']);
        expect((await svc.run(false, SHOWCASE_LISTS, now)).skipped).toContain('sylius');
        await svc.scheduled();
        expect(await svc.sendDeals([{ code: '1', price: 1, originalPrice: 2 }])).toBeNull();
        expect(inShopStock).not.toHaveBeenCalled();
        expect(method).not.toHaveBeenCalled();
    });

    it('крон: ошибка базы не выбрасывается наружу', async () => {
        inShopStock.mockRejectedValue(new Error('db down'));
        await expect(make().scheduled()).resolves.toBeUndefined();
    });

    describe('sendDeals', () => {
        it('скидка по убыванию, только в наличии; итог запоминается для ручки', async () => {
            const svc = make();
            await svc.sendDeals([
                { code: '476318', price: 8000, originalPrice: 10000 },
                { code: '561526', price: 5000, originalPrice: 10000 },
                { code: '777', price: 1000, originalPrice: 10000 }, // нет в магазине
            ]);
            expect(method).toHaveBeenCalledWith('/api/v2/admin/showcase/update', 'post', {
                list: 'deals',
                codes: ['561526', '476318'],
            });
            method.mockClear();
            const res = await svc.run(false, ['deals'], now);
            expect(res.lists).toEqual([{ list: 'deals', count: 2, received: 2, notFound: 1 }]);
            expect(method).toHaveBeenCalledWith('/api/v2/admin/showcase/update', 'post', {
                list: 'deals',
                codes: ['561526', '476318'],
            });
            expect(res.dealsComputedAt).not.toBeNull();
            expect(inShopStock).toHaveBeenCalledTimes(1); // только в sendDeals: для одного deals Trade не читаем
        });

        it('пустой набор цен (отправка цен не прошла) — список на сайте не трогаем', async () => {
            expect(await make().sendDeals([])).toBeNull();
            expect(method).not.toHaveBeenCalled();
        });
    });
});
