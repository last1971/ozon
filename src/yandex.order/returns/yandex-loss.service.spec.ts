import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JobService } from '../../job/job.service';
import { JobModule } from '../../job/job.module';
import { FIREBIRD, FirebirdModule } from '../../firebird/firebird.module';
import { MpReturnAcceptStore } from '../../mp-event/mp-return-accept.store';
import { LossSaveHooks, LossSnapshot, LOSS_STATS_STORE } from '../../marketplace-loss/loss.contracts';
import { LossStatsStore } from '../../marketplace-loss/loss-stats.store';
import { MarketplaceLossModule } from '../../marketplace-loss/marketplace-loss.module';
import { SaveLossSnapshotCommand } from '../../marketplace-loss/loss.commands';
import { YandexOrderModule } from '../yandex.order.module';
import { YandexLossService } from './yandex-loss.service';
import { LoadYandexLossSalesCommand } from './load-yandex-loss-sales.command';
import { LoadYandexWriteOffsCommand } from './load-yandex-write-offs.command';
import { CalculateYandexLossReportCommand } from './calculate-yandex-loss-report.command';

const now = new Date('2026-11-06T10:00:00Z');

/** Строка REALPRICE JOIN S: GOODSCODE, PIECES, TOTAL_QUAN. */
const salesRow = (goodscode: string, pieces: number, totalQuan: number) => ({
    GOODSCODE: goodscode,
    PIECES: pieces,
    TOTAL_QUAN: totalQuan,
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

/** pool мок: первый query (продажи) возвращает rows, остальные (хранилище) — пустые. */
function makePool(salesRows: any[] = []) {
    const t = {
        query: jest.fn().mockResolvedValue(salesRows),
        execute: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    return { pool: { getTransaction: jest.fn().mockResolvedValue(t) }, t };
}

function setup(salesRows: any[] = [salesRow('123', 1, 3)]) {
    const jobs = new JobService();
    const { pool, t } = makePool(salesRows);
    const writeOffs = { listRecordedWriteOffs: jest.fn().mockResolvedValue([]) };
    const lossStore = {
        read: jest.fn(),
        replace: jest.fn(async (snapshot: LossSnapshot, hooks: LossSaveHooks) => {
            await hooks.checkpoint(0, snapshot.rows.length);
            await hooks.checkpoint(snapshot.rows.length, snapshot.rows.length);
            await hooks.beforeCommit();
        }),
    };
    const config = new ConfigService({ SERVICES: ['yandex'], YANDEX_BUYER_ID: 24465 });
    const service = new YandexLossService(
        jobs,
        config,
        new LoadYandexLossSalesCommand(pool as any, config),
        new LoadYandexWriteOffsCommand(writeOffs as any),
        new CalculateYandexLossReportCommand(),
        new SaveLossSnapshotCommand(lossStore),
    );
    const run = (date = now) => jobs.whenDone(service.start('client', date).id);
    return { jobs, pool, t, writeOffs, lossStore, config, service, run };
}

describe('Сохранение статистики Яндекса через общие команды', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('продажи из Firebird и списание дают корректные доли; preliminary=false, 90 дней', async () => {
        const { run, writeOffs, lossStore } = setup([salesRow('123', 1, 3)]);
        writeOffs.listRecordedWriteOffs.mockResolvedValue([writtenOff]);
        const done = await run();
        expect(done.status).toBe('done');
        expect(done.result).toMatchObject({
            service: 'YANDEX',
            preliminary: false,
            from: '2026-08-08',
            to: '2026-11-06',
        });
        expect(lossStore.replace.mock.calls[0][0]).toMatchObject({ service: 'YANDEX', preliminary: false });
        const rows = lossStore.replace.mock.calls[0][0].rows;
        // '123': 3 продажи, 0 списаний
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ offerId: '123', soldUnits: 3, returnedUnits: 0, returnRate: 0 }),
        ]));
        // '123-4': 0 продаж, 1 списание → defectRate null
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ offerId: '123-4', soldUnits: 0, writtenOffUnits: 1, defectRate: null }),
        ]));
    });

    it('продажи с фасовкой: TOTAL_QUAN/PIECES = soldUnits', async () => {
        // 12 штук в пачках по 4 = 3 пачки
        const { run, lossStore } = setup([salesRow('456', 4, 12)]);
        const done = await run();
        expect(done.status).toBe('done');
        const rows = lossStore.replace.mock.calls[0][0].rows;
        expect(rows.find((r: any) => r.offerId === '456-4')?.soldUnits).toBe(3);
    });

    it('нет продаж и нет списаний — пустой снимок сохраняется', async () => {
        const { run, lossStore } = setup([]);
        expect((await run()).status).toBe('done');
        expect(lossStore.replace.mock.calls[0][0].rows).toHaveLength(0);
    });

    it('списание без продаж — defectRate null, нет деления на ноль', async () => {
        const { run, writeOffs, lossStore } = setup([]);
        writeOffs.listRecordedWriteOffs.mockResolvedValue([writtenOff]);
        expect((await run()).status).toBe('done');
        expect(lossStore.replace.mock.calls[0][0].rows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ offerId: '123-4', soldUnits: 0, writtenOffUnits: 1, defectRate: null }),
            ]),
        );
    });

    it('ошибка Firebird не вызывает сохранение', async () => {
        const { run, t, lossStore } = setup();
        t.query.mockReset().mockRejectedValue(new Error('Firebird недоступен'));
        const done = await run();
        expect(done.status).toBe('failed');
        expect(lossStore.replace).not.toHaveBeenCalled();
    });

    it('некорректный GOODSCODE в ответе Firebird — ошибка без сохранения', async () => {
        const { run, lossStore } = setup([{ GOODSCODE: null, PIECES: 1, TOTAL_QUAN: 5 }]);
        const done = await run();
        expect(done.status).toBe('failed');
        expect(lossStore.replace).not.toHaveBeenCalled();
    });

    it('ошибка записи в БД — job завершается с ошибкой, повтор проходит', async () => {
        const { run, lossStore } = setup();
        lossStore.replace.mockRejectedValueOnce(new Error('БД недоступна'));
        expect((await run()).status).toBe('failed');
        expect((await run()).status).toBe('done');
        expect(lossStore.replace).toHaveBeenCalledTimes(2);
    });

    it('повторный старт одного периода объединяется существующим JobService', async () => {
        const { service, jobs, lossStore } = setup();
        const first = service.start('one', now);
        const second = service.start('two', new Date(now.getTime() + 1000));
        expect(second.id).toBe(first.id);
        expect((await jobs.whenDone(first.id)).status).toBe('done');
        expect(lossStore.replace).toHaveBeenCalledTimes(1);
    });

    it('отключённый Яндекс не запускает загрузку и запись', async () => {
        const { service, config, t, lossStore } = setup();
        jest.spyOn(config, 'get').mockReturnValue(['ozon']);
        expect(() => service.start()).toThrow('не подключён');
        expect(t.query).not.toHaveBeenCalled();
        expect(lossStore.replace).not.toHaveBeenCalled();
    });

    it('Nest инжектирует FirebirdModule и общее хранилище; цепочка записывает YANDEX в SQL', async () => {
        const transaction = {
            query: jest.fn().mockResolvedValue([salesRow('777', 1, 2)]),
            execute: jest.fn().mockResolvedValue(undefined),
            commit: jest.fn().mockResolvedValue(undefined),
            rollback: jest.fn().mockResolvedValue(undefined),
        };
        const pool = { getTransaction: jest.fn().mockResolvedValue(transaction) };
        // Проверяем метаданные модуля без запуска Nest-контейнера
        expect(Reflect.getMetadata('imports', YandexOrderModule)).toContain(MarketplaceLossModule);
        expect(Reflect.getMetadata('imports', YandexOrderModule)).toContain(FirebirdModule);
        expect(Reflect.getMetadata('providers', YandexOrderModule)).toContain(YandexLossService);
        expect(Reflect.getMetadata('exports', YandexOrderModule)).toContain(YandexLossService);

        // Поднимаем минимальный контейнер: мокаем хранилище напрямую, не тянем FirebirdModule
        const storeMock = {
            read: jest.fn(),
            replace: jest.fn(async (_snap: any, hooks: any) => {
                await hooks.checkpoint(0, 1);
                await hooks.checkpoint(1, 1);
                await hooks.beforeCommit();
            }),
        };
        const module = await Test.createTestingModule({
            imports: [JobModule],
            providers: [
                YandexLossService,
                LoadYandexLossSalesCommand,
                LoadYandexWriteOffsCommand,
                CalculateYandexLossReportCommand,
                SaveLossSnapshotCommand,
                { provide: ConfigService, useValue: new ConfigService({ SERVICES: ['yandex'], YANDEX_BUYER_ID: 24465 }) },
                { provide: MpReturnAcceptStore, useValue: { listRecordedWriteOffs: jest.fn().mockResolvedValue([]) } },
                { provide: FIREBIRD, useValue: pool },
                { provide: LOSS_STATS_STORE, useValue: storeMock },
            ],
        }).compile();
        try {
            const job = module.get(YandexLossService).start(undefined, now);
            expect((await module.get(JobService).whenDone(job.id)).status).toBe('done');
            // Firebird-запрос был выполнен
            expect(transaction.query).toHaveBeenCalledTimes(1);
            // snapshot сохранён с правильным сервисом
            expect(storeMock.replace.mock.calls[0][0]).toMatchObject({ service: 'YANDEX', preliminary: false });
        } finally {
            await module.close();
        }
    });
});
