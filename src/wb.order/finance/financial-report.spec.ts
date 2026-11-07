import { Logger } from '@nestjs/common';
import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { clearRateLimitCache } from '../../helpers/decorators/rate-limit.decorator';
import { WbFinancialReportService } from './financial-report.service';
import { WbFinancialReportReader } from './financial-report.reader';
import { WbFinancialContext, WB_FINANCIAL_REPORT_URL } from './financial-report.context';
import {
    ValidateWbFinancialReportCommand,
    LoadWbFinancialReportCommand,
    NormalizeWbFinancialReportCommand,
} from './financial-report.commands';
import { normalizeFinancialRow } from './financial-row';
const dates = { from: new Date('2026-10-26T00:00:00+03:00'), to: new Date('2026-11-01T23:59:59+03:00') };
const raw = (rrdId = 1) => ({
    rrdId,
    orderId: 6073904900,
    orderDt: '2026-10-26T10:00:00+03:00',
    srid: 's1',
    stickerId: '123',
    forPay: '123.45',
    deliveryService: '44.2',
    penalty: '2',
    additionalPayment: '-1.35',
    sellerOperName: 'Продажа',
});
const context = (): WbFinancialContext => ({ ...dates, cursor: 0, raw: [], rows: [], progress: emptyProgress() });
function setup() {
    const reader = {
        page: jest
            .fn()
            .mockResolvedValueOnce([raw(1)])
            .mockResolvedValueOnce([raw(2)])
            .mockResolvedValue([]),
    };
    const jobs = new JobService();
    const service = new WbFinancialReportService(
        jobs,
        new ValidateWbFinancialReportCommand(),
        new LoadWbFinancialReportCommand(reader as any),
        new NormalizeWbFinancialReportCommand(),
    );
    return { service, jobs, reader };
}
describe('Новый финансовый загрузчик ВБ', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
        clearRateLimitCache();
    });
    afterEach(() => jest.restoreAllMocks());
    it('конвертирует строковые деньги и переименованные поля, сохраняя исходные данные', () => {
        expect(normalizeFinancialRow(raw())).toEqual({
            rrd_id: 1,
            assembly_id: 6073904900,
            order_dt: raw().orderDt,
            srid: 's1',
            sticker_id: '123',
            ppvz_for_pay: 123.45,
            delivery_rub: 44.2,
            penalty: 2,
            additional_payment: -1.35,
            raw: raw(),
        });
    });
    it.each(['forPay', 'deliveryService', 'penalty', 'additionalPayment'])(
        'не подставляет 0 при отсутствии %s',
        (field) => {
            const r: any = raw();
            delete r[field];
            expect(() => normalizeFinancialRow(r)).toThrow('сумма');
        },
    );
    it.each(['', null, 'broken', 'Infinity', NaN])('отклоняет неверную сумму %j', (value) =>
        expect(() => normalizeFinancialRow({ ...raw(), forPay: value })).toThrow(),
    );
    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '99999999999999999'])('не искажает неверный ID %s', (rrdId) =>
        expect(() => normalizeFinancialRow({ ...raw(), rrdId })).toThrow(),
    );
    it('проверяет период и курсор до запроса API', async () => {
        const { service, jobs, reader } = setup();
        for (const d of [
            { from: new Date('bad'), to: dates.to },
            { from: dates.to, to: dates.from },
        ])
            expect((await jobs.whenDone(service.start(d).id)).status).toBe('failed');
        expect(reader.page).not.toHaveBeenCalled();
    });
    it('читает до пустой страницы, даже если предыдущая короткая; возвращает 100% и прежний DTO', async () => {
        const { service, jobs, reader } = setup();
        const done = await jobs.whenDone(service.start(dates).id);
        expect(done.status).toBe('done');
        expect(done.progress.percent).toBe(100);
        expect(done.result).toEqual([normalizeFinancialRow(raw(1)), normalizeFinancialRow(raw(2))]);
        expect(reader.page).toHaveBeenCalledTimes(3);
    });
    it('одинаковые дубли не удваиваются; разные версии одного rrdId отклоняются', async () => {
        const { service, jobs, reader } = setup();
        reader.page
            .mockReset()
            .mockResolvedValueOnce([raw(1)])
            .mockResolvedValueOnce([raw(1), raw(2)])
            .mockResolvedValue([]);
        expect((await jobs.whenDone(service.start(dates).id)).result).toHaveLength(2);
        reader.page
            .mockReset()
            .mockResolvedValueOnce([raw(1), { ...raw(1), forPay: '0' }])
            .mockResolvedValue([]);
        const done = await jobs.whenDone(service.start(dates).id);
        expect(done.status).toBe('failed');
        expect(done.result).toBeUndefined();
    });
    it('повторный курсор завершает job ошибкой без частичного результата', async () => {
        const { service, jobs, reader } = setup();
        reader.page.mockReset().mockResolvedValue([raw(1)]);
        const done = await jobs.whenDone(service.start(dates).id);
        expect(done.status).toBe('failed');
        expect(done.result).toBeUndefined();
        expect(reader.page).toHaveBeenCalledTimes(2);
    });
    it('ошибка второй страницы не возвращает первую как полный отчёт', async () => {
        const { service, jobs, reader } = setup();
        reader.page
            .mockReset()
            .mockResolvedValueOnce([raw(1)])
            .mockRejectedValueOnce(new Error('429'));
        await expect(service.read(dates)).rejects.toThrow('429');
    });
    it('ошибка преобразования последней строки не публикует частичный результат', async () => {
        const { service, jobs, reader } = setup();
        reader.page
            .mockReset()
            .mockResolvedValueOnce([raw(1), { ...raw(2), forPay: 'bad' }])
            .mockResolvedValue([]);
        const done = await jobs.whenDone(service.start(dates).id);
        expect(done.status).toBe('failed');
        expect(done.result).toBeUndefined();
        expect(done.progress.percent).toBeLessThan(100);
    });
    it('предел страниц завершает загрузку ошибкой без результата', async () => {
        const { service, jobs, reader } = setup();
        reader.page.mockReset().mockImplementation(async (ctx) => [raw(ctx.cursor + 1)]);
        const done = await jobs.whenDone(service.start(dates).id);
        expect(done.status).toBe('failed');
        expect(done.error).toContain('предел страниц');
        expect(done.result).toBeUndefined();
    });
    it('разные периоды не объединяются, повтор того же периода объединяется', async () => {
        const { service, jobs } = setup();
        const a = service.start(dates);
        expect(service.start(dates).id).toBe(a.id);
        const b = service.start({ ...dates, to: new Date('2026-11-02') });
        expect(b.id).not.toBe(a.id);
        await Promise.all([jobs.whenDone(a.id), jobs.whenDone(b.id)]);
    });
    it('сохраняет caller cursor и нормализует московские даты', async () => {
        const ctx = context();
        ctx.cursor = 10;
        await new ValidateWbFinancialReportCommand().execute(ctx);
        const api = { method: jest.fn().mockResolvedValue('') };
        expect(await new WbFinancialReportReader(api as any).page(ctx)).toEqual([]);
        expect(api.method).toHaveBeenCalledWith(
            WB_FINANCIAL_REPORT_URL,
            'post',
            {
                dateFrom: '2026-10-26T00:00:00.000+03:00',
                dateTo: '2026-11-01T23:59:59.000+03:00',
                rrdId: 10,
                limit: 100000,
                period: 'weekly',
            },
            true,
        );
    });
    it.each([null, undefined, { status: 'NotOk', error: { status: 403 } }, 'broken'])(
        'не выдаёт ответ %j за отсутствие данных',
        async (value) => {
            const reader = new WbFinancialReportReader({ method: async () => value } as any);
            await expect(reader.page(context())).rejects.toThrow('не прочитан');
        },
    );
    it('отмена во время загрузки не продолжает цепочку', async () => {
        const { service, jobs, reader } = setup();
        let release: (r: any) => void;
        reader.page.mockReset().mockImplementationOnce(
            () =>
                new Promise((r) => {
                    release = r;
                }),
        );
        const job = service.start(dates);
        while (!release) await new Promise((r) => setImmediate(r));
        jobs.cancel(job.id);
        release([raw()]);
        await new Promise((r) => setImmediate(r));
        const done = await jobs.whenDone(job.id);
        expect(done.status).toBe('failed');
        expect(done.result).toBeUndefined();
        expect(reader.page).toHaveBeenCalledTimes(1);
    });
    it('преобразование большого отчёта уступает event loop', async () => {
        const ctx = context();
        ctx.raw = Array.from({ length: 1500 }, (_, i) => raw(i + 1));
        let reached = false;
        setImmediate(() => {
            reached = true;
        });
        await new NormalizeWbFinancialReportCommand().execute(ctx);
        expect(reached).toBe(true);
        expect(ctx.rows).toHaveLength(1500);
    });
});
