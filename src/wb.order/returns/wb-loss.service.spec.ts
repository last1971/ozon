import { WbLossFinancialCommands } from './wb-loss-financial.commands';
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
import { WbOrderService } from '../wb.order.service';
import { WbOrderModule } from '../wb.order.module';
import { WbLossService } from './wb-loss.service';
import { LoadWbLossSalesCommand } from './load-sales.command';
import { LoadWbWriteOffsCommand } from './load-write-offs.command';
import { CalculateWbLossReportCommand } from './calculate-loss-report.command';

const now = new Date('2026-11-06T10:00:00Z');
const sale = (saleID: string, supplierArticle = '123', extra = {}) => ({
    saleID,
    supplierArticle,
    srid: 'order-' + saleID,
    date: '2026-10-20T10:00:00',
    lastChangeDate: '2026-10-21T10:00:00',
    ...extra,
});
const writtenOff = {
    id: 1,
    service: 'WB',
    goodscode: '123',
    pieces: 4,
    units: 1,
    quan: 4,
    spisCode: 42,
    spisSs: 1,
    spisAt: new Date('2026-10-22T10:00:00Z'),
    documentQuantity: 4,
};
const deferred = () => {
    let resolve: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve: () => resolve() };
};
function setup(rows: unknown[] = ['S1', 'S2', 'S3', 'R1', 'R2', 'R3'].map((id) => sale(id))) {
    const jobs = new JobService();
    const orders = { getSales: jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]) };
    const writeOffs = { listRecordedWriteOffs: jest.fn().mockResolvedValue([]) };
    const store = {
        read: jest.fn(),
        replace: jest.fn(async (snapshot: LossSnapshot, hooks: LossSaveHooks) => {
            await hooks.checkpoint(0, snapshot.rows.length);
            await hooks.checkpoint(snapshot.rows.length, snapshot.rows.length);
            await hooks.beforeCommit();
        }),
    };
    const config = new ConfigService({ SERVICES: ['wb'] });
    const service = new WbLossService(
        jobs,
        config,
        new LoadWbLossSalesCommand(orders as any),
        new LoadWbWriteOffsCommand(writeOffs as any),
        new CalculateWbLossReportCommand(),
        new SaveLossSnapshotCommand(store),
        { loading: [], apply: { execute: async (ctx) => ctx } } as any,
    );
    const run = (date = now) => jobs.whenDone(service.start('client', date).id);
    return { jobs, orders, writeOffs, store, config, service, run };
}

describe('Сохранение статистики ВБ через общие команды', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('3 продажи и 3 возврата дают 100%; сохраняет предварительный снимок за 90 дней, без политики Ozon', async () => {
        const { run, orders, store, writeOffs } = setup();
        const done = await run();
        expect(done.status).toBe('done');
        expect(done.progress).toMatchObject({ phase: 'Сохранение статистики', percent: 100, done: 1, total: 1 });
        expect(done.result).toEqual({
            service: 'WB',
            preliminary: true,
            from: '2026-08-08',
            to: '2026-11-06',
            calculatedAt: now,
            rows: 1,
        });
        expect(orders.getSales.mock.calls).toEqual([['2026-08-08'], ['2026-10-21T10:00:00']]);
        expect(writeOffs.listRecordedWriteOffs).toHaveBeenCalledWith('WB', '2026-08-08', '2026-11-06');
        expect(store.replace).toHaveBeenCalledTimes(1);
        expect(store.replace.mock.calls[0][0]).toEqual({
            service: 'WB',
            preliminary: true,
            calculatedAt: now,
            period: { from: '2026-08-08', to: '2026-11-06' },
            rows: [
                {
                    offerId: '123',
                    soldUnits: 3,
                    returnedUnits: 3,
                    writtenOffUnits: 0,
                    returnRate: 1,
                    defectRate: 0,
                    warnings: [],
                },
            ],
        });
    });

    it('исправление заменяет старую операцию, повторы на стыке страниц не удваивают её, фасовки раздельные', async () => {
        const { run, orders, store, writeOffs } = setup([]);
        const original = sale('S1');
        const corrected = sale('S1', '123-4', { lastChangeDate: '2026-10-22T10:00:00' });
        orders.getSales
            .mockReset()
            .mockResolvedValueOnce([original])
            .mockResolvedValueOnce([original, sale('S2', '123-1'), sale('R1', '123-4'), corrected])
            .mockResolvedValue([]);
        writeOffs.listRecordedWriteOffs.mockResolvedValue([writtenOff]);
        expect((await run()).status).toBe('done');
        expect(store.replace.mock.calls[0][0].rows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    offerId: '123',
                    soldUnits: 1,
                    returnedUnits: 0,
                    returnRate: 0,
                    defectRate: 0,
                }),
                expect.objectContaining({
                    offerId: '123-4',
                    soldUnits: 1,
                    returnedUnits: 1,
                    writtenOffUnits: 1,
                    returnRate: 1,
                    defectRate: 1,
                }),
            ]),
        );
        expect(store.replace.mock.calls[0][0].rows).toHaveLength(2);
    });

    it('возврат или списание без продаж сохраняет неизвестную долю, без деления на ноль', async () => {
        const { run, writeOffs, store } = setup([sale('R1')]);
        writeOffs.listRecordedWriteOffs.mockResolvedValue([writtenOff]);
        expect((await run()).status).toBe('done');
        expect(store.replace.mock.calls[0][0].rows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    offerId: '123',
                    soldUnits: 0,
                    returnedUnits: 1,
                    returnRate: null,
                    defectRate: null,
                }),
                expect.objectContaining({
                    offerId: '123-4',
                    soldUnits: 0,
                    writtenOffUnits: 1,
                    returnRate: null,
                    defectRate: null,
                }),
            ]),
        );
    });

    it('потери выше продаж сохраняются с предупреждением без обрезания до 100%', async () => {
        const { run, store } = setup([sale('S1'), sale('R1'), sale('R2')]);
        expect((await run()).status).toBe('done');
        expect(store.replace.mock.calls[0][0].rows[0]).toMatchObject({ returnRate: 2, returnedUnits: 2 });
        expect(store.replace.mock.calls[0][0].rows[0].warnings.length).toBeGreaterThan(0);
    });

    it('при сдвиге окна старые операции исчезают, пустой снимок также передаётся на замену', async () => {
        const { run, orders, store } = setup([]);
        const rows = ['S1', 'R1'].map((id) => sale(id, '123', { date: '2026-08-08T00:00:00' }));
        orders.getSales
            .mockReset()
            .mockResolvedValueOnce(rows)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(rows)
            .mockResolvedValueOnce([]);
        expect((await run()).status).toBe('done');
        expect(store.replace.mock.calls[0][0].rows[0].returnRate).toBe(1);
        expect((await run(new Date('2026-11-07T10:00:00Z'))).status).toBe('done');
        expect(store.replace.mock.calls[1][0]).toMatchObject({
            period: { from: '2026-08-09', to: '2026-11-07' },
            rows: [],
        });
    });

    it('Московская полночь завершает предыдущий день; сегодняшний день не входит', async () => {
        const { run, store } = setup([
            sale('S1', '123', { date: '2026-11-05T23:59:59' }),
            sale('R1', '123', { date: '2026-11-06T00:00:00' }),
        ]);
        expect((await run(new Date('2026-11-05T21:01:00Z'))).status).toBe('done');
        expect(store.replace.mock.calls[0][0]).toMatchObject({
            period: { from: '2026-08-08', to: '2026-11-06' },
            rows: [expect.objectContaining({ soldUnits: 1, returnedUnits: 0, returnRate: 0 })],
        });
    });

    it.each(['api', 'response', 'cursor', 'row', 'conflict', 'writeOff', 'document'])(
        'ошибка %s не вызывает сохранение и не выдаёт частичный результат',
        async (failure) => {
            const { run, orders, writeOffs, store } = setup();
            if (failure === 'api') orders.getSales.mockReset().mockRejectedValue(Error('API недоступен'));
            if (failure === 'response') orders.getSales.mockReset().mockResolvedValue({ error: true });
            if (failure === 'cursor') orders.getSales.mockReset().mockResolvedValue([sale('S1')]);
            if (failure === 'row')
                orders.getSales
                    .mockReset()
                    .mockResolvedValueOnce([sale('S1', 'bad')])
                    .mockResolvedValue([]);
            if (failure === 'conflict')
                orders.getSales
                    .mockReset()
                    .mockResolvedValueOnce([sale('S1'), sale('S1', '999')])
                    .mockResolvedValue([]);
            if (failure === 'writeOff') writeOffs.listRecordedWriteOffs.mockRejectedValue(Error('БД недоступна'));
            if (failure === 'document')
                writeOffs.listRecordedWriteOffs.mockResolvedValue([{ ...writtenOff, documentQuantity: null }]);
            const done = await run();
            expect(done.status).toBe('failed');
            expect(done.result).toBeUndefined();
            expect(done.progress.percent).toBeLessThan(100);
            expect(store.replace).not.toHaveBeenCalled();
        },
    );

    it('ошибка записи видна в job; следующий запуск возможен', async () => {
        const { run, store } = setup();
        store.replace.mockRejectedValueOnce(Error('Запись не выполнена'));
        const failed = await run();
        expect(failed).toMatchObject({ status: 'failed', error: 'Запись не выполнена' });
        expect(failed.result).toBeUndefined();
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

    it('отключённый ВБ не запускает загрузку и запись; строка SERVICES тоже поддерживается', async () => {
        const { service, config, orders, store, run } = setup();
        const get = jest.spyOn(config, 'get').mockReturnValue(['ozon']);
        expect(() => service.start()).toThrow('не подключён');
        expect(orders.getSales).not.toHaveBeenCalled();
        expect(store.replace).not.toHaveBeenCalled();
        get.mockReturnValue('ozon,wb');
        expect((await run()).status).toBe('done');
    });

    it('отмена во время записи ждёт отката, до commit не доходит', async () => {
        const { service, jobs, store } = setup();
        const entered = deferred(),
            release = deferred(),
            rollingBack = deferred(),
            rolledBack = deferred();
        let committed = false;
        store.replace.mockImplementation(async (_, hooks) => {
            entered.resolve();
            await release.promise;
            try {
                await hooks.checkpoint(1, 2);
                await hooks.beforeCommit();
                committed = true;
            } catch (error) {
                rollingBack.resolve();
                await rolledBack.promise;
                throw error;
            }
        });
        const job = service.start(undefined, now);
        await entered.promise;
        jobs.cancel(job.id);
        release.resolve();
        await rollingBack.promise;
        expect(jobs.get(job.id).status).toBe('running');
        rolledBack.resolve();
        const done = await jobs.whenDone(job.id);
        expect(done).toMatchObject({ status: 'failed', error: 'отменена' });
        expect(done.result).toBeUndefined();
        expect(committed).toBe(false);
    });

    it('во время commit отмена не выдаёт ложную ошибку, после записи прогресс 100%', async () => {
        const { service, jobs, store } = setup();
        const entered = deferred(),
            release = deferred();
        store.replace.mockImplementation(async (_, hooks) => {
            await hooks.beforeCommit();
            entered.resolve();
            await release.promise;
        });
        const job = service.start(undefined, now);
        await entered.promise;
        jobs.cancel(job.id);
        expect(jobs.get(job.id).status).toBe('running');
        expect(jobs.get(job.id).progress.percent).toBeLessThan(100);
        release.resolve();
        expect(await jobs.whenDone(job.id)).toMatchObject({ status: 'done', progress: { percent: 100 } });
    });

    it('Nest инжектирует общее хранилище; настоящая цепочка записывает WB в SQL и делает один commit', async () => {
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
                WbLossService,
                { provide: WbLossFinancialCommands, useValue: { loading: [], apply: { execute: async (ctx) => ctx } } },
                LoadWbLossSalesCommand,
                LoadWbWriteOffsCommand,
                CalculateWbLossReportCommand,
                { provide: ConfigService, useValue: new ConfigService({ SERVICES: ['wb'] }) },
                {
                    provide: WbOrderService,
                    useValue: {
                        getSales: jest
                            .fn()
                            .mockResolvedValueOnce([sale('S1'), sale('R1')])
                            .mockResolvedValue([]),
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
            expect(Reflect.getMetadata('imports', WbOrderModule)).toContain(MarketplaceLossModule);
            expect(Reflect.getMetadata('providers', WbOrderModule)).toContain(WbLossService);
            expect(Reflect.getMetadata('exports', WbOrderModule)).toContain(WbLossService);
            const job = module.get(WbLossService).start(undefined, now);
            expect((await module.get(JobService).whenDone(job.id)).status).toBe('done');
            expect(transaction.execute).toHaveBeenCalledWith(
                'DELETE FROM MP_LOSS_STATS WHERE SERVICE = ?',
                ['WB'],
                false,
            );
            expect(transaction.execute).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO MP_LOSS_STATS'),
                ['WB', 123, 1, 1, 1, 0, 1, 0, 'READY', now, null],
                false,
            );
            expect(transaction.execute).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE MP_LOSS_STATE SET'),
                [now, '2026-08-08', '2026-11-06', 1, 'WB'],
                false,
            );
            expect(transaction.commit).toHaveBeenCalledTimes(1);
            expect(transaction.rollback).not.toHaveBeenCalled();
        } finally {
            await module.close();
        }
    });
});
