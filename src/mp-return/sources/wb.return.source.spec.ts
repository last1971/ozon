import { BadGatewayException } from '@nestjs/common';
import { WbGoodsReturnRow, WbReturnSource, toReturnLine } from './wb.return.source';
import { WbGoodsReturnReportService } from '../../wb.api/wb.goods-return.report.service';

// Паузы между страницами отчёта в тестах не нужны.
jest.mock('../../helpers/decorators/rate-limit.decorator', () => ({ RateLimit: () => () => undefined }));

/** Строки отчёта кабинета опта 19.10.2026: «Выдано» и «В пути» (реле, заказ 5682378996). */
const issued: WbGoodsReturnRow = {
    shkId: 58572006177,
    stickerId: '55601576448',
    orderId: 5925944066,
    srid: 'mp.6f53cace902f4c87bf543e68f11d83c4.r',
    nmId: 1102521843,
    status: 'Выдано',
    returnType: 'Возврат товара, который приехал по МП, продавцу',
    reason: '',
    completedDt: '2026-10-09T09:37:11',
};
const onTheWay: WbGoodsReturnRow = {
    shkId: 57628275528,
    stickerId: '57628275528',
    orderId: 5682378996,
    srid: 'mp.58b299343e8c498f8474b416d15887cb.r',
    nmId: 976022449,
    status: 'В пути в пвз',
    returnType: 'Возврат товара, который приехал по МП, продавцу',
    reason: '',
    completedDt: null,
};
const card = { nmID: 1102521843, vendorCode: '531720', title: 'Динамик 8 Ом' } as any;

describe('WbReturnSource', () => {
    const make = (
        report: any = {
            count: 2,
            report: [issued, onTheWay].map(({ status, reason, ...row }) => ({
                ...row,
                returnStatus: status,
                returnReason: reason,
            })),
        },
        invoices: Record<string, boolean> = { '5925944066': true, '5682378996': true },
        services = ['ozon', 'wb'],
    ) => {
        const api = { method: jest.fn(async () => report) };
        const cards = { getWbCardByNmId: jest.fn((nmId: number) => (nmId === card.nmID ? card : null)) };
        const invoiceService = { findByPosting: jest.fn(async (p: string) => (invoices[p] ? ({} as any) : null)) };
        const config = { get: jest.fn(() => services) };
        const reportService = new WbGoodsReturnReportService(api as any);
        const source = new WbReturnSource(reportService, cards as any, invoiceService as any, config as any);
        return { source, api, invoiceService };
    };

    it('строка отчёта → строка возврата; тип возврата в статусе, не в причине; время московское', () => {
        expect(toReturnLine(issued, card, '5925944066', 'FBS')).toEqual({
            service: 'WB',
            extId: '58572006177',
            posting: '5925944066',
            offerId: '531720',
            productName: 'Динамик 8 Ом',
            units: 1,
            reason: null,
            isBuyout: false,
            isOpened: false,
            receivedAt: '2026-10-09T09:37:11.000+03:00',
            barcode: '55601576448',
            schema: 'FBS',
            stateName: 'Выдано — Возврат товара, который приехал по МП, продавцу',
        });
    });

    it('карточка не загружена — артикул пустой, в названии подсказка', () => {
        const line = toReturnLine(onTheWay, null, '5682378996', null);
        expect(line.offerId).toBe('');
        expect(line.productName).toContain('976022449');
        expect(line.receivedAt).toBeNull();
    });

    it('ВБ не ответил (NotOk) — ошибка «не прочитан», а не пустой список', async () => {
        const { source } = make({ result: null, status: 'NotOk', error: { status: 429 } });
        await expect(source.listReceived(new Date('2026-10-01'), new Date('2026-10-20'))).rejects.toThrow(
            BadGatewayException,
        );
        await expect(source.find({ kind: 'extId', value: '1' })).rejects.toThrow('ВБ: отчёт возвратов не прочитан');
    });

    it('отчёт — active и archive за 93 дня, одно чтение на список и скан (кэш)', async () => {
        const { source, api } = make();
        await source.listReceived(new Date('2026-10-01'), new Date('2026-10-20'));
        await source.find({ kind: 'extId', value: '55601576448' });
        expect(api.method).toHaveBeenCalledTimes(2);
        const params = api.method.mock.calls.map((c: any[]) => c[2]);
        expect(params.map(({ status }) => status)).toEqual(['active', 'archive']);
        for (const { dateFrom, dateTo, limit, offset } of params) {
            expect((Date.parse(dateTo) - Date.parse(dateFrom)) / 864e5).toBe(92);
            expect(limit).toBe(1000);
            expect(offset).toBe(0);
        }
    });

    it('список — только «Выдано» с датой забора в окне', async () => {
        const { source } = make();
        expect((await source.listReceived(new Date('2026-10-01'), new Date('2026-10-20'))).map((l) => l.extId)).toEqual(
            ['58572006177'],
        );
        expect(await source.listReceived(new Date('2026-10-10'), new Date('2026-10-20'))).toEqual([]);
    });

    it.each([
        ['стикер', '55601576448'],
        ['ШК', '58572006177'],
        ['заказ', '5925944066'],
        ['srid', 'mp.6f53cace902f4c87bf543e68f11d83c4.r'],
    ])('скан находит возврат по %s', async (_, value) => {
        const { source } = make();
        expect((await source.find({ kind: 'extId', value })).map((l) => l.extId)).toEqual(['58572006177']);
    });

    it('«В пути» по скану отдаётся без даты получения — предупреждение, не запрет', async () => {
        const { source } = make();
        const [line] = await source.find({ kind: 'posting', value: '5682378996' });
        expect(line.receivedAt).toBeNull();
        expect(line.stateName).toMatch(/^В пути в пвз/);
    });

    it('счёт по заказу (FBS), иначе по srid (FBO), иначе номер заказа без схемы', async () => {
        const fbs = await make().source.find({ kind: 'extId', value: '5925944066' });
        expect(fbs[0]).toEqual(expect.objectContaining({ posting: '5925944066', schema: 'FBS' }));

        const fbo = await make(undefined, { [issued.srid]: true }).source.find({ kind: 'extId', value: '5925944066' });
        expect(fbo[0]).toEqual(expect.objectContaining({ posting: issued.srid, schema: 'FBO' }));

        const none = await make(undefined, {}).source.find({ kind: 'extId', value: '5925944066' });
        expect(none[0]).toEqual(expect.objectContaining({ posting: '5925944066', schema: null }));
    });

    it('промах по скану перечитывает отчёт, но не чаще раза в 30 с', async () => {
        const { source, api } = make();
        const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T10:00:00Z'));
        expect(await source.find({ kind: 'extId', value: '99999999999' })).toEqual([]);
        expect(api.method).toHaveBeenCalledTimes(2);
        now.mockReturnValue(Date.parse('2026-10-19T10:00:31Z'));
        await source.find({ kind: 'extId', value: '99999999999' });
        expect(api.method).toHaveBeenCalledTimes(4);
        now.mockRestore();
    });

    it('ВБ не подключён (SERVICES) — пусто, к ВБ не ходим', async () => {
        const { source, api } = make(undefined, undefined, ['ozon']);
        expect(await source.listReceived(new Date('2026-10-01'), new Date('2026-10-20'))).toEqual([]);
        expect(await source.find({ kind: 'extId', value: '55601576448' })).toEqual([]);
        expect(api.method).not.toHaveBeenCalled();
    });
});
