import { normalizeWbLoss } from './wb-loss-history.source';
import { ConfigService } from '@nestjs/config';
import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { LoadWbLossSalesCommand } from './load-sales.command';
import { LoadWbWriteOffsCommand } from './load-write-offs.command';
import { CalculateWbLossReportCommand } from './calculate-loss-report.command';
import { WbReturnPreviewService } from './return-preview.service';
import { WbReturnPreviewController } from './return-preview.controller';
import { WbReturnPreviewContext } from './return-preview.context';

const sale = (id: string, changed = '2026-10-21T10:00:00.12345') => ({
    saleID: id,
    supplierArticle: '123',
    srid: 'order',
    date: '2026-10-20T10:00:00',
    lastChangeDate: changed,
});
const writeOff = {
    id: 1,
    service: 'WB',
    goodscode: '123',
    units: 1,
    pieces: 1,
    quan: 1,
    spisCode: 42,
    spisSs: 1,
    spisAt: new Date('2026-10-22'),
    documentQuantity: 1,
};
const context = (): WbReturnPreviewContext => ({
    service: 'WB',
    preliminary: true,
    progress: emptyProgress(),
    period: { from: '2026-08-08', to: '2026-11-06' },
    sales: [],
    writeOffs: [],
    rows: [],
});

describe('Команды отчёта ВБ', () => {
    it('получает все страницы до пустой, сохраняя полный курсор; пересечение страниц не теряет возврат', async () => {
        const orders = {
            getSales: jest
                .fn()
                .mockResolvedValueOnce([sale('S1')])
                .mockResolvedValueOnce([sale('S1'), sale('R1', '2026-10-22T10:00:00')])
                .mockResolvedValueOnce([]),
        };
        const ctx = await new LoadWbLossSalesCommand(orders as any).execute(context());
        expect(orders.getSales.mock.calls).toEqual([
            ['2026-08-08'],
            ['2026-10-21T10:00:00.12345'],
            ['2026-10-22T10:00:00'],
        ]);
        expect(ctx.sales).toHaveLength(3);
        ctx.progress.done = 0;
        await new CalculateWbLossReportCommand().execute(ctx);
        expect(ctx.rows[0]).toMatchObject({ soldUnits: 1, returnedUnits: 1, returnRate: 1 });
    });
    it('204 и пустая история допустимы', async () => {
        for (const empty of ['', []]) {
            const ctx = await new LoadWbLossSalesCommand({ getSales: async () => empty } as any).execute(context());
            expect(ctx.sales).toEqual([]);
        }
    });
    it.each([null, { status: 429 }, { error: true }, undefined])(
        'ошибка %j не подменяет историю пустым массивом',
        async (response) => {
            await expect(
                new LoadWbLossSalesCommand({ getSales: async () => response } as any).execute(context()),
            ).rejects.toThrow('Не удалось');
        },
    );
    it('повторный курсор прерывает цепочку', async () => {
        await expect(
            new LoadWbLossSalesCommand({ getSales: async () => [sale('S1')] } as any).execute(context()),
        ).rejects.toThrow('курсор');
    });
    it('отмена после сетевого ответа не продолжает разбор', async () => {
        const ctx = context();
        const orders = {
            getSales: async () => {
                ctx.stopChain = true;
                return [sale('S1')];
            },
        };
        await expect(new LoadWbLossSalesCommand(orders as any).execute(ctx)).rejects.toThrow('остановлена');
        expect(ctx.sales).toHaveLength(0);
    });
    it('списания читает за тот же период только для ВБ', async () => {
        const store = { listRecordedWriteOffs: jest.fn().mockResolvedValue([writeOff]) };
        const ctx = await new LoadWbWriteOffsCommand(store as any).execute(context());
        expect(store.listRecordedWriteOffs).toHaveBeenCalledWith('WB', '2026-08-08', '2026-11-06');
        expect(ctx.progress).toMatchObject({ done: 1, total: 1 });
        expect(ctx.writeOffs).toEqual([writeOff]);
    });
    it('расчёт уступает event loop, считает проценты и освобождает сырые данные', async () => {
        const ctx = context();
        ctx.sales = Array.from({ length: 1500 }, (_, i) => normalizeWbLoss(sale('S' + i)));
        ctx.writeOffs = [writeOff];
        let eventLoopReached = false;
        setImmediate(() => {
            eventLoopReached = true;
        });
        await new CalculateWbLossReportCommand().execute(ctx);
        expect(eventLoopReached).toBe(true);
        expect(ctx.rows[0]).toMatchObject({ soldUnits: 1500, defectRate: 1 / 1500 });
        expect(ctx.sales).toEqual([]);
        expect(ctx.writeOffs).toEqual([]);
    });
    it('отмена в длинном расчёте прекращает формирование отчёта', async () => {
        const ctx = context();
        ctx.sales = Array.from({ length: 1500 }, (_, i) => normalizeWbLoss(sale('S' + i)));
        setImmediate(() => {
            ctx.stopChain = true;
        });
        await expect(new CalculateWbLossReportCommand().execute(ctx)).rejects.toThrow('остановлена');
        expect(ctx.rows).toEqual([]);
    });
});

describe('Сквозной отчёт ВБ через существующий JobService', () => {
    function setup() {
        const jobs = new JobService();
        const orders = {
            getSales: jest
                .fn()
                .mockResolvedValueOnce([sale('S1'), sale('S2'), sale('R1')])
                .mockResolvedValue([]),
        };
        const store = { listRecordedWriteOffs: jest.fn().mockResolvedValue([writeOff]) };
        const config = new ConfigService({ SERVICES: ['wb'] });
        const preview = new WbReturnPreviewService(
            jobs,
            config,
            new LoadWbLossSalesCommand(orders as any),
            new LoadWbWriteOffsCommand(store as any),
            new CalculateWbLossReportCommand(),
        );
        return { jobs, orders, store, preview, config };
    }
    it('цепочка заканчивается 100%, возвращает обе доли; повторный старт не создаёт вторую задачу', async () => {
        const { jobs, preview, orders } = setup();
        const now = new Date('2026-11-06T10:00:00Z');
        const job = preview.start('client', now);
        expect(preview.start('client', now).id).toBe(job.id);
        const done = await jobs.whenDone(job.id);
        expect(done.status).toBe('done');
        expect(done.progress.percent).toBe(100);
        expect(done.result).toMatchObject({
            service: 'WB',
            preliminary: true,
            from: '2026-08-08',
            to: '2026-11-06',
            rows: [
                expect.objectContaining({
                    soldUnits: 2,
                    returnedUnits: 1,
                    writtenOffUnits: 1,
                    returnRate: 0.5,
                    defectRate: 0.5,
                }),
            ],
        });
        expect(orders.getSales).toHaveBeenCalledTimes(2);
    });
    it('ошибка источника завершает задачу failed, не читает списания и не публикует частичный результат', async () => {
        const { jobs, preview, orders, store } = setup();
        orders.getSales.mockReset().mockResolvedValue({ error: true });
        const done = await jobs.whenDone(preview.start().id);
        expect(done.status).toBe('failed');
        expect(done.result).toBeUndefined();
        expect(store.listRecordedWriteOffs).not.toHaveBeenCalled();
        expect(done.progress.percent).toBeLessThan(100);
    });
    it('ошибка списания не публикует проценты', async () => {
        const { jobs, preview, store } = setup();
        store.listRecordedWriteOffs.mockResolvedValue([{ ...writeOff, documentQuantity: null }]);
        const done = await jobs.whenDone(preview.start().id);
        expect(done.status).toBe('failed');
        expect(done.result).toBeUndefined();
    });
    it('не запускает отчёт для отключённой площадки', () => {
        const { preview, config } = setup();
        jest.spyOn(config, 'get').mockReturnValue(['ozon']);
        expect(() => preview.start()).toThrow('не подключён');
    });
    it('контроллер передаёт запуск существующему исполнителю', () => {
        const preview = { start: jest.fn().mockReturnValue({ id: 'job' }) };
        expect(new WbReturnPreviewController(preview as any).start('client')).toEqual({ id: 'job' });
        expect(preview.start).toHaveBeenCalledWith('client');
    });
});
