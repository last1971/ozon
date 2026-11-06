import { emptyProgress } from '../interfaces/i.job.context';
import { JobService } from '../job/job.service';
import { ILossHistorySource, ILossStatsStore, LossOperation, LossSaveHooks } from './loss.contracts';
import {
    CalculateLossReportCommand,
    LoadLossHistoryCommand,
    LoadLossWriteOffsCommand,
    SaveLossSnapshotCommand,
    SaveLossContext,
} from './loss.commands';
import { WbLossHistorySource } from '../wb.order/returns/wb-loss-history.source';

const operation = (id: string, kind: 'sale' | 'return', units: number): LossOperation => ({
    id,
    kind,
    units,
    offerId: '123-4',
    orderId: 'order',
    occurredAt: '2026-10-20T12:00:00',
    changedAt: '2026-10-21T12:00:00',
});
const context = (service = 'WB'): SaveLossContext => ({
    service,
    preliminary: false,
    period: { from: '2026-08-08', to: '2026-11-06' },
    calculatedAt: new Date('2026-11-06T10:00:00Z'),
    progress: emptyProgress(),
    sales: [],
    writeOffs: [],
    rows: [],
});
const writeOff = (service: string) => ({
    service,
    id: 1,
    goodscode: '123',
    pieces: 4,
    units: 1,
    quan: 4,
    spisCode: 17,
    spisSs: 1,
    spisAt: new Date('2026-10-21T12:00:00Z'),
    documentQuantity: 4,
});
function storeMock(): ILossStatsStore & { replace: jest.Mock } {
    return {
        read: async () => null,
        replace: jest.fn(async (snapshot, hooks: LossSaveHooks) => {
            await hooks.checkpoint?.(snapshot.rows.length, snapshot.rows.length);
            await hooks.beforeCommit?.();
        }),
    };
}
function run(source: ILossHistorySource, store = storeMock(), ctx = context(source.service)) {
    const jobs = new JobService();
    const writeOffs = { listRecordedWriteOffs: jest.fn().mockResolvedValue([writeOff(source.service)]) };
    const job = jobs.run<SaveLossContext, SaveLossContext['rows']>({
        kind: 'loss-test:' + source.service,
        params: {},
        context: ctx,
        commands: [
            new LoadLossHistoryCommand(source),
            new LoadLossWriteOffsCommand(writeOffs),
            new CalculateLossReportCommand(),
            new SaveLossSnapshotCommand(store),
        ],
        // Store освобождает свою транзакцию до завершения команды. JobService ждёт этого при отмене.
        cleanup: async () => {},
        canCancel: (c) => !c.committing,
        result: (c) => c.rows,
    });
    return { jobs, job, store, ctx, writeOffs };
}

describe('Общая цепочка потерь через интерфейсы', () => {
    it.each(['OZON', 'YANDEX', 'AVITO'])(
        'одни команды для %s: несколько пачек в операции, произвольный курсор',
        async (service) => {
            const source: ILossHistorySource = {
                service,
                preliminary: false,
                readPage: jest
                    .fn()
                    .mockResolvedValueOnce({ operations: [operation('sale', 'sale', 3)], next: 'page:2' })
                    .mockResolvedValueOnce({ operations: [operation('return', 'return', 3)], next: null }),
            };
            const { jobs, job, store, writeOffs } = run(source);
            const done = await jobs.whenDone(job.id);
            expect(done.status).toBe('done');
            expect(done.progress.percent).toBe(100);
            expect(source.readPage).toHaveBeenNthCalledWith(2, 'page:2');
            expect(writeOffs.listRecordedWriteOffs).toHaveBeenCalledWith(service, '2026-08-08', '2026-11-06');
            expect(store.replace.mock.calls[0][0]).toMatchObject({
                service,
                preliminary: false,
                rows: [
                    expect.objectContaining({
                        offerId: '123-4',
                        soldUnits: 3,
                        returnedUnits: 3,
                        writtenOffUnits: 1,
                        returnRate: 1,
                        defectRate: 1 / 3,
                    }),
                ],
            });
        },
    );
    it('реальный адаптер ВБ подключается к той же цепочке без своей формулы', async () => {
        const rows = ['S1', 'S2', 'R1'].map((saleID) => ({
            saleID,
            supplierArticle: '123-4',
            srid: 'order',
            date: '2026-10-20T12:00:00',
            lastChangeDate: '2026-10-21T12:00:00',
        }));
        const orders = { getSales: jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]) };
        const { jobs, job, store } = run(new WbLossHistorySource(orders));
        expect((await jobs.whenDone(job.id)).status).toBe('done');
        expect(store.replace.mock.calls[0][0]).toMatchObject({
            service: 'WB',
            preliminary: true,
            rows: [expect.objectContaining({ soldUnits: 2, returnedUnits: 1, returnRate: 0.5, defectRate: 0.5 })],
        });
    });
    it('несовпадение площадки останавливает чтение', async () => {
        const source = { service: 'WB', preliminary: true, readPage: jest.fn() };
        await expect(new LoadLossHistoryCommand(source).execute(context('OZON'))).rejects.toThrow('другой площадки');
        expect(source.readPage).not.toHaveBeenCalled();
    });
    it('повторный непрозрачный курсор не позволяет сохранить неполную статистику', async () => {
        const { jobs, job, store, writeOffs } = run({
            service: 'AVITO',
            preliminary: false,
            readPage: async () => ({ operations: [], next: 'page:2' }),
        });
        expect((await jobs.whenDone(job.id)).status).toBe('failed');
        expect(store.replace).not.toHaveBeenCalled();
        expect(writeOffs.listRecordedWriteOffs).not.toHaveBeenCalled();
    });
    it('ошибка API не превращается в пустой снимок', async () => {
        const { jobs, job, store } = run({
            service: 'WB',
            preliminary: true,
            readPage: async () => {
                throw Error('API недоступен');
            },
        });
        expect((await jobs.whenDone(job.id)).error).toBe('API недоступен');
        expect(store.replace).not.toHaveBeenCalled();
    });
    it.each([0, -1, 0.5, NaN])('неверное количество %s отклоняется до сохранения', async (units) => {
        const { jobs, job, store } = run({
            service: 'OZON',
            preliminary: false,
            readPage: async () => ({ operations: [operation('s', 'sale', units)], next: null }),
        });
        expect((await jobs.whenDone(job.id)).status).toBe('failed');
        expect(store.replace).not.toHaveBeenCalled();
    });
    it('одинаковая версия с разным количеством не выбирается произвольно', async () => {
        const ctx = context();
        ctx.sales = [operation('s', 'sale', 1), operation('s', 'sale', 2)];
        await expect(new CalculateLossReportCommand().execute(ctx)).rejects.toThrow('Неоднозначная');
        expect(ctx.rows).toEqual([]);
    });
    it('ошибка сохранения завершает общую задачу failed без результата', async () => {
        const store = storeMock();
        store.replace.mockRejectedValue(Error('БД недоступна'));
        const { jobs, job } = run(
            { service: 'WB', preliminary: true, readPage: async () => ({ operations: [], next: null }) },
            store,
        );
        const done = await jobs.whenDone(job.id);
        expect(done.status).toBe('failed');
        expect(done.result).toBeUndefined();
        expect(done.progress.percent).toBeLessThan(100);
    });
    it('отмена до записи не вызывает хранилище', async () => {
        const ctx = context();
        ctx.stopChain = true;
        const store = storeMock();
        await expect(new SaveLossSnapshotCommand(store).execute(ctx)).rejects.toThrow('остановлена');
        expect(store.replace).not.toHaveBeenCalled();
    });
    it('отмена на порции записи передаётся хранилищу до commit', async () => {
        const ctx = context();
        const store = storeMock();
        store.replace.mockImplementation(async (_, hooks: LossSaveHooks) => {
            ctx.stopChain = true;
            await hooks.checkpoint(1, 2);
            await hooks.beforeCommit();
        });
        await expect(new SaveLossSnapshotCommand(store).execute(ctx)).rejects.toThrow('остановлена');
        expect(ctx.committing).toBeUndefined();
        expect(ctx.progress).toMatchObject({ done: 1, total: 2 });
    });
    it('во время commit JobService не обещает отмену уже сохраняемого результата', async () => {
        const store = storeMock();
        let enterCommit: () => void;
        let finishCommit: () => void;
        const entered = new Promise<void>((resolve) => {
            enterCommit = resolve;
        });
        const finished = new Promise<void>((resolve) => {
            finishCommit = resolve;
        });
        store.replace.mockImplementation(async (_, hooks: LossSaveHooks) => {
            await hooks.beforeCommit();
            enterCommit();
            await finished;
        });
        const { jobs, job, ctx } = run(
            { service: 'WB', preliminary: true, readPage: async () => ({ operations: [], next: null }) },
            store,
        );
        await entered;
        jobs.cancel(job.id);
        expect(ctx.stopChain).toBeUndefined();
        finishCommit();
        expect((await jobs.whenDone(job.id)).status).toBe('done');
    });
});
