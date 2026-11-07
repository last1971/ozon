import { JobService } from '../job/job.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { OzonReturnService } from './ozon.return.service';
import { cronConfig } from '../cron.setup.provider/cron.setup';

const now = new Date('2026-11-05T02:38:00Z');
const setup = (settings = {}) => {
    const products = {
        listAllOfferIds: jest.fn().mockResolvedValue(['123']),
        infoList: jest.fn().mockResolvedValue([{ sku: '123', marketSku: 10, cabinetSku: 11, typeId: 1 }]),
    };
    const preview = {
        preview: jest.fn().mockResolvedValue({
            rows: [{ offerId: '123', soldUnits: 3, paidReturnUnits: 3, returnPerc: 1 }],
            issues: [],
        }),
    };
    const store = { replace: jest.fn().mockResolvedValue(undefined), listKnownOffers: jest.fn().mockResolvedValue([]) };
    const writeOffs = { listRecordedWriteOffs: jest.fn().mockResolvedValue([]) };
    const values = { NODE_ENV: 'production', SERVICES: ['ozon'], ...settings };
    const config = { get: (key, fallback) => values[key] ?? fallback } as ConfigService;
    return {
        products,
        preview,
        store,
        service: new OzonReturnService(
            config,
            products as any,
            preview as any,
            store as any,
            writeOffs as any,
            new JobService(),
            {
                loading: [],
                calculate: {
                    execute: async (ctx) => {
                        ctx.expenses = new Map();
                        return ctx;
                    },
                },
            } as any,
        ),
    };
};
describe('Ежедневный пересчёт возвратов', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());
    it('90 завершённых дней, обе SKU из существующего каталога, запись готового результата', async () => {
        const { service, preview, store } = setup();
        expect(await service.recalculate(now)).toEqual({ rows: 1, from: '2026-08-07', to: '2026-11-05' });
        expect(preview.preview).toHaveBeenCalledWith(
            '2026-08-07',
            '2026-11-05',
            new Map([
                ['10', '123'],
                ['11', '123'],
            ]),
        );
        expect(store.replace).toHaveBeenCalledWith(
            expect.objectContaining({
                service: 'OZON',
                calculatedAt: now,
                rows: [
                    expect.objectContaining({
                        offerId: '123',
                        soldUnits: 3,
                        returnedUnits: 3,
                        returnRate: 1,
                        appliedReturnRate: 1,
                    }),
                ],
            }),
            expect.any(Object),
        );
    });
    it('граница дня определяется по Москве', async () => {
        const { service, preview } = setup();
        await service.recalculate(new Date('2026-11-04T21:01:00Z'));
        expect(preview.preview.mock.calls[0].slice(0, 2)).toEqual(['2026-08-07', '2026-11-05']);
    });
    it('передаёт настройки малой истории и резерва', async () => {
        const { service, store } = setup({ OZON_RETURN_MIN_SALES: '5', OZON_RETURN_PERC_DEFAULT: '0.07' });
        await service.recalculate(now);
        expect(store.replace.mock.calls[0][0].rows[0].appliedReturnRate).toBe(0.07);
        expect(store.replace.mock.calls[0][0].rows[0].returnRate).toBe(1);
    });
    it.each([{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, { SERVICES: ['wb'] }])(
        'не запускает запись для %j',
        async (settings) => {
            const { service, products, store } = setup(settings);
            await service.daily();
            expect(products.listAllOfferIds).not.toHaveBeenCalled();
            expect(store.replace).not.toHaveBeenCalled();
        },
    );
    it('задача зарегистрирована только в production, сохраняет часовой пояс декоратора', () => {
        expect(cronConfig.ozonReturnPerc).toEqual({ production: true, development: false });
        expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', OzonReturnService.prototype.daily)).toMatchObject({
            name: 'ozonReturnPerc',
            timeZone: 'Europe/Moscow',
        });
    });
    it('ошибка API, чтения истории или записи выходит наружу; следующий запуск возможен', async () => {
        for (const failure of ['catalog', 'history', 'save']) {
            const { service, products, preview, store } = setup();
            const method =
                failure === 'catalog'
                    ? products.listAllOfferIds
                    : failure === 'history'
                      ? preview.preview
                      : store.replace;
            method.mockRejectedValueOnce(new Error(failure));
            await expect(service.recalculate(now)).rejects.toThrow(failure);
            if (failure !== 'save') expect(store.replace).not.toHaveBeenCalled();
            await expect(service.recalculate(now)).resolves.toMatchObject({ rows: 1 });
        }
    });
    it('cron журналирует ошибку без необработанного отклонения', async () => {
        const { service, products } = setup({ SERVICES: 'ozon,wb' });
        products.listAllOfferIds.mockRejectedValue(new Error('offline'));
        await expect(service.daily()).resolves.toBeUndefined();
        expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('offline'));
    });
    it('не допускает два пересчёта одновременно', async () => {
        const { service, products, store } = setup();
        let release: (v: string[]) => void;
        products.listAllOfferIds.mockReturnValueOnce(
            new Promise((resolve) => {
                release = resolve;
            }),
        );
        const first = service.recalculate(now);
        while (!release) await new Promise<void>((resolve) => setImmediate(resolve));
        await expect(service.recalculate(now)).rejects.toThrow('уже выполняется');
        release(['123']);
        await first;
        expect(store.replace).toHaveBeenCalledTimes(1);
    });
    it.each(['empty', 'missing', 'duplicate', 'conflict', 'issues', 'over100'])(
        'не сохраняет повреждённые данные: %s',
        async (problem) => {
            const { service, products, preview, store } = setup();
            if (problem === 'empty') products.listAllOfferIds.mockResolvedValue([]);
            if (problem === 'missing') products.infoList.mockResolvedValue([]);
            if (problem === 'duplicate') products.infoList.mockResolvedValue([{ sku: '123' }, { sku: '123' }] as any);
            if (problem === 'conflict') {
                products.listAllOfferIds.mockResolvedValue(['123', '124']);
                products.infoList.mockResolvedValue([
                    { sku: '123', marketSku: 10 },
                    { sku: '124', marketSku: 10 },
                ] as any);
            }
            if (problem === 'issues') preview.preview.mockResolvedValue({ rows: [], issues: [{}] } as any);
            if (problem === 'over100')
                preview.preview.mockResolvedValue({
                    rows: [{ offerId: '123', soldUnits: 1, paidReturnUnits: 2, returnPerc: 2 }],
                    issues: [],
                });
            await expect(service.recalculate(now)).rejects.toThrow();
            expect(store.replace).not.toHaveBeenCalled();
        },
    );
    it('валидация настроек до сети и сохранения', async () => {
        const { service, products, store } = setup({ OZON_RETURN_MIN_SALES: 'bad' });
        await expect(service.recalculate(now)).rejects.toThrow();
        expect(products.listAllOfferIds).not.toHaveBeenCalled();
        expect(store.replace).not.toHaveBeenCalled();
    });
    it('читает каталог через существующий метод пачками по 100', async () => {
        const { service, products, store } = setup();
        const offers = Array.from({ length: 205 }, (_, i) => String(i + 100));
        products.listAllOfferIds.mockResolvedValue(offers);
        products.infoList.mockImplementation(async (batch) => batch.map((sku) => ({ sku, marketSku: Number(sku) })));
        await service.recalculate(now);
        expect(products.infoList.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 5]);
        expect(store.replace.mock.calls[0][0].rows).toHaveLength(205);
    });
});
