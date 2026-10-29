import { BadGatewayException } from '@nestjs/common';
import { WbGoodsReturnReportService, wbReturnCompletedAt } from './wb.goods-return.report.service';

jest.mock('../helpers/decorators/rate-limit.decorator', () => ({ RateLimit: () => () => undefined }));

const apiRow = (shkId: number) => ({
    shkId,
    stickerId: `sticker-${shkId}`,
    orderId: shkId + 100,
    srid: `srid-${shkId}`,
    nmId: shkId + 200,
    returnStatus: 'Выдано',
    returnType: 'Возврат товара',
    returnReason: 'Не подошёл',
    completedDt: '2026-10-09T09:37:11',
});

describe('WbGoodsReturnReportService', () => {
    it('разбирает completedDt нового отчёта с пробелом как московское время', () => {
        const row = { status: 'Выдано', completedDt: '2026-10-29 06:32:37' } as any;

        expect(wbReturnCompletedAt(row)?.toISO()).toBe('2026-10-29T06:32:37.000+03:00');
    });

    it('читает обе вкладки, листает ответ и приводит новые имена полей к общей модели', async () => {
        const api = {
            method: jest
                .fn()
                .mockResolvedValueOnce({ count: 2, report: [apiRow(1)] })
                .mockResolvedValueOnce({ count: 2, report: [apiRow(2)] })
                .mockResolvedValueOnce(''),
        };
        const service = new WbGoodsReturnReportService(api as any);

        const rows = await service.rows();

        expect(api.method).toHaveBeenCalledTimes(3);
        expect(api.method.mock.calls.map((call) => call[2])).toEqual([
            expect.objectContaining({ status: 'active', limit: 1000, offset: 0 }),
            expect.objectContaining({ status: 'active', limit: 1000, offset: 1 }),
            expect.objectContaining({ status: 'archive', limit: 1000, offset: 0 }),
        ]);
        expect(rows.map(({ shkId, status, reason }) => ({ shkId, status, reason }))).toEqual([
            { shkId: 1, status: 'Выдано', reason: 'Не подошёл' },
            { shkId: 2, status: 'Выдано', reason: 'Не подошёл' },
        ]);
    });

    it('ошибку API отдаёт как ошибку чтения отчёта, а не как пустой список', async () => {
        const api = { method: jest.fn().mockResolvedValue({ status: 'NotOk', error: { status: 404 } }) };
        const service = new WbGoodsReturnReportService(api as any);

        await expect(service.rows()).rejects.toThrow(BadGatewayException);
    });
});
