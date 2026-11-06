import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JobService } from '../../job/job.service';
import { JobModule } from '../../job/job.module';
import { FIREBIRD } from '../../firebird/firebird.module';
import { MpReturnAcceptStore } from '../../mp-event/mp-return-accept.store';
import { LossSaveHooks, LossSnapshot, LOSS_STATS_STORE } from '../../marketplace-loss/loss.contracts';
import { LossStatsStore } from '../../marketplace-loss/loss-stats.store';
import { MarketplaceLossModule } from '../../marketplace-loss/marketplace-loss.module';
import { SaveLossSnapshotCommand } from '../../marketplace-loss/loss.commands';
import { YandexOrderService } from '../yandex.order.service';
import { YandexOrderModule } from '../yandex.order.module';
import { YandexLossService } from './yandex-loss.service';
import { LoadYandexLossSalesCommand } from './load-yandex-loss-sales.command';
import { LoadYandexWriteOffsCommand } from './load-yandex-write-offs.command';
import { CalculateYandexLossReportCommand } from './calculate-yandex-loss-report.command';

const now = new Date('2026-11-06T10:00:00Z');
/** DELIVERED заказ с одной позицией. */
const order = (id: number, offerId = '123', count = 1, extra: Record<string, unknown> = {}) => ({
    id,
    status: 'DELIVERED',
    creationDate: '05-10-2026 12:00:00',
    items: [{ id: 1, offerId, count }],
    ...extra,
});

const writtenOff = {
    id: 1,
    service: 'YANDEX',
    goodscode: '123',
    pieces: 4,
    units: 1,
    quan: 4,
    spisCode: 42,
    spisSs: 1,
    spisAt: new Date('2026-10-22T10:00:00Z'),
    documentQuantity: 4,
};

function setup(orders: ReturnType<typeof order>[] = [order(1), order(2), order(3, '123', 1)]) {
    const jobs = new JobService();
    // Возвращает заказы только в первом окне, остальные окна пустые.
    const listOrders = jest.fn().mockResolvedValueOnce(orders).mockResolvedValue([]);
    const writeOffs = { listRecordedWriteOffs: jest.fn().mockResolvedValue([]) };
    const store = {
        read: jest.fn(),
        replace: jest.fn(async (snapshot: LossSnapshot, hooks: LossSaveHooks) => {
            await hooks.checkpoint(0, snapshot.rows.length);
            await hooks.checkpoint(snapshot.rows.length, snapshot.rows.length);
            await hooks.beforeCommit();
        }),
    };
    const config = new ConfigService({ SERVICES: ['yandex'] });
    const service = new YandexLossService(
        jobs,
        config,
        new LoadYandexLossSalesCommand({ listOrders } as any),
        new LoadYandexWriteOffsCommand(writeOffs as any),
        new CalculateYandexLossReportCommand(),
        new SaveLossSnapshotCommand(store),
    );
    const run = (date = now) => jobs.whenDone(service.start('client', date).id);
    return { jobs, listOrders, writeOffs, store, config, service, run };
}

describe('Сохранение статистики Яндекса через общие команды', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('3 доставленных заказа и списание дают корректные доли; снимок за 90 дней', async () => {
        const { run, listOrders, writeOffs, store } = setup();
        writeOffs.listRecordedWriteOffs.mockResolvedValue([writtenOff]);
        const done = await run();
        expect(done.status).toBe('done');
        // 2 строки: '123' (3 продажи, 0 списаний) и '123-4' (0 продаж, 1 списание)
        expect(done.result).toMatchObject({
            service: 'YANDEX',
            preliminary: true,
            from: '2026-08-08',
            to: '2026-11-06',
            calculatedAt: now,
        });
        expect(writeOffs.listRecordedWriteOffs).toHaveBeenCalledWith('YANDEX', '2026-08-08', '2026-11-06');
        expect(store.replace).toHaveBeenCalledTimes(1);
        expect(store.replace.mock.calls[0][0]).toMatchObject({
            service: 'YANDEX',
            preliminary: true,
        });
        const rows = store.replace.mock.calls[0][0].rows;
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ offerId: '123', soldUnits: 3, returnedUnits: 0, returnRate: 0 }),
        ]));
        // Запросы разбиваются на 29-дневные окна — 90 дней = 4 запроса
        expect(listOrders.mock.calls.length).toBeGreaterThanOrEqual(3);
        listOrders.mock.calls.forEach((call) => {
            expect(call[0]).toMatchObject({ status: 'DELIVERED' });
            expect(typeof call[0].fromDate).toBe('string');
            expect(typeof call[0].toDate).toBe('string');
        });
    });

    it('нет заказов и нет списаний — пустой снимок сохраняется', async () => {
        const { run, store } = setup([]);
        expect((await run()).status).toBe('done');
        expect(store.replace.mock.calls[0][0].rows).toHaveLength(0);
    });

    it('списание без продаж — defectRate null, нет деления на ноль', async () => {
        const { run, writeOffs, store } = setup([]);
        writeOffs.listRecordedWriteOffs.mockResolvedValue([writtenOff]);
        expect((await run()).status).toBe('done');
        expect(store.replace.mock.calls[0][0].rows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    offerId: '123-4',
                    soldUnits: 0,
                    writtenOffUnits: 1,
                    defectRate: null,
                }),
            ]),
        );
    });

    it('ошибка API не вызывает сохранение', async () => {
        const { run, listOrders, store } = setup();
        listOrders.mockReset().mockRejectedValue(new Error('API Яндекс недоступен'));
        expect((await run()).status).toBe('failed');
        expect(store.replace).not.toHaveBeenCalled();
    });

    it('некорректный offerId в заказе — ошибка без сохранения', async () => {
        const { run, listOrders, store } = setup();
        listOrders.mockReset().mockResolvedValue([order(1, '', 1)]);
        expect((await run()).status).toBe('failed');
        expect(store.replace).not.toHaveBeenCalled();
    });

    it('заказ без массива items — ошибка без сохранения', async () => {
        const { run, listOrders, store } = setup();
        listOrders.mockReset().mockResolvedValue([{ id: 99, status: 'DELIVERED' }]);
        const done = await run();
        expect(done.status).toBe('failed');
        expect(done.error).toMatch(/позиций/);
        expect(store.replace).not.toHaveBeenCalled();
    });

    it('дубль заказа в разных окнах не удваивает продажи', async () => {
        const { jobs, writeOffs, store } = setup();
        const config = new ConfigService({ SERVICES: ['yandex'] });
        // Возвращаем один и тот же заказ в двух разных окнах
        const listOrders = jest
            .fn()
            .mockResolvedValueOnce([order(1, '456', 2)])
            .mockResolvedValueOnce([order(1, '456', 2)])
            .mockResolvedValue([]);
        const service = new YandexLossService(
            jobs,
            config,
            new LoadYandexLossSalesCommand({ listOrders } as any),
            new LoadYandexWriteOffsCommand(writeOffs as any),
            new CalculateYandexLossReportCommand(),
            new SaveLossSnapshotCommand(store),
        );
        const done = await jobs.whenDone(service.start('c', now).id);
        expect(done.status).toBe('done');
        const rows = store.replace.mock.calls[0][0].rows;
        expect(rows.find((r: any) => r.offerId === '456')?.soldUnits).toBe(2);
    });

    it('ошибка записи в БД — job завершается с ошибкой', async () => {
        const { run, store } = setup();
        store.replace.mockRejectedValueOnce(new Error('БД недоступна'));
        expect((await run()).status).toBe('failed');
        expect((await run()).status).toBe('done');
        expect(store.replace).toHaveBeenCalledTimes(2);
    });

    it('повторный старт одного периода объединяется существующим JobService', async () => {
        const { service, jobs, store } = setup();
        const first = service.start('one', now);
        const second = service.start('two', new Date(now.getTime() + 1000));
        expect(second.id).toBe(first.id);
        expect((await jobs.whenDone(first.id)).status).toBe('done');
        expect(store.replace).toHaveBeenCalledTimes(1);
    });

    it('отключённый Яндекс не запускает загрузку и запись', async () => {
        const { service, config, listOrders, store, run } = setup();
        jest.spyOn(config, 'get').mockReturnValue(['ozon']);
        expect(() => service.start()).toThrow('не подключён');
        expect(listOrders).not.toHaveBeenCalled();
        expect(store.replace).not.toHaveBeenCalled();
    });

    it('Nest инжектирует общее хранилище; настоящая цепочка записывает YANDEX в SQL', async () => {
        const transaction = {
            query: jest.fn().mockResolvedValue([]),
            execute: jest.fn().mockResolvedValue(undefined),
            commit: jest.fn().mockResolvedValue(undefined),
            rollback: jest.fn().mockResolvedValue(undefined),
        };
        const pool = { getTransaction: jest.fn().mockResolvedValue(transaction) };
        const module = await Test.createTestingModule({
            imports: [JobModule, MarketplaceLossModule],
            providers: [
                YandexLossService,
                LoadYandexLossSalesCommand,
                LoadYandexWriteOffsCommand,
                CalculateYandexLossReportCommand,
                { provide: ConfigService, useValue: new ConfigService({ SERVICES: ['yandex'] }) },
                {
                    provide: YandexOrderService,
                    useValue: {
                        listOrders: jest.fn().mockResolvedValueOnce([order(1), order(2, '123', 1)]).mockResolvedValue([]),
                    },
                },
                { provide: MpReturnAcceptStore, useValue: { listRecordedWriteOffs: jest.fn().mockResolvedValue([]) } },
            ],
        })
            .overrideProvider(FIREBIRD)
            .useValue(pool)
            .compile();
        try {
            expect(module.get(LOSS_STATS_STORE)).toBe(module.get(LossStatsStore));
            expect(Reflect.getMetadata('imports', YandexOrderModule)).toContain(MarketplaceLossModule);
            expect(Reflect.getMetadata('providers', YandexOrderModule)).toContain(YandexLossService);
            expect(Reflect.getMetadata('exports', YandexOrderModule)).toContain(YandexLossService);
            const job = module.get(YandexLossService).start(undefined, now);
            expect((await module.get(JobService).whenDone(job.id)).status).toBe('done');
            expect(transaction.execute).toHaveBeenCalledWith(
                'DELETE FROM MP_LOSS_STATS WHERE SERVICE = ?',
                ['YANDEX'],
                false,
            );
            expect(transaction.commit).toHaveBeenCalledTimes(1);
        } finally {
            await module.close();
        }
    });
});
