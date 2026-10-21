import { BadGatewayException } from '@nestjs/common';
import { YandexReturn, YandexReturnSource, toReturnLines } from './yandex.return.source';

/** Записи кабинета розницы 21.10.2026: невыкуп забран, невыкуп в пути, возврат после выкупа. */
const unredeemed: YandexReturn = {
    id: 123741939,
    orderId: 62026013058,
    returnType: 'UNREDEEMED',
    shipmentStatus: 'PICKED',
    updateDate: '2026-10-20T11:50:55.467+03:00',
    items: [{ shopSku: '539789', count: 1, tracks: [{ trackCode: '62026013058-1' }] }],
};
const inTransit: YandexReturn = {
    id: 124366706,
    orderId: 63019143552,
    returnType: 'UNREDEEMED',
    shipmentStatus: 'IN_TRANSIT',
    updateDate: '2026-10-19T12:33:00.000+03:00',
    items: [{ shopSku: '551552', count: 1, tracks: [{ trackCode: '63019143552-1' }] }],
};
const buyout: YandexReturn = {
    id: 27059326,
    orderId: 58532670400,
    returnType: 'RETURN',
    shipmentStatus: 'PICKED',
    updateDate: '2026-08-12T08:36:24.961+03:00',
    items: [
        {
            shopSku: '527059-5',
            count: 1,
            decisions: [{ reasonType: 'BAD_QUALITY', comment: 'Диоды не соответствуют оригиналу' }],
            tracks: [{ trackCode: 'VOZ_FBS_27059326' }],
        },
    ],
};

describe('YandexReturnSource', () => {
    const make = (pages: any[] = [ok([unredeemed, inTransit, buyout])], services = ['ozon', 'yandex']) => {
        const api = {
            campaignId: jest.fn(async () => 65613878),
            method: jest.fn(async (..._: any[]) => pages.shift() ?? ok([])),
        };
        const config = { get: jest.fn(() => services) };
        return { source: new YandexReturnSource(api as any, config as any), api };
    };

    it('невыкуп → строка возврата: заказ = отправление, трек коробки = штрихкод', () => {
        expect(toReturnLines(unredeemed)).toEqual([
            {
                service: 'YANDEX',
                extId: '123741939',
                posting: '62026013058',
                offerId: '539789',
                productName: null,
                units: 1,
                reason: null,
                isBuyout: false,
                isOpened: false,
                receivedAt: expect.any(String),
                barcode: '62026013058-1',
                schema: 'FBS',
                stateName: 'Невыкуп — забран магазином',
            },
        ]);
        expect(Date.parse(toReturnLines(unredeemed)[0].receivedAt)).toBe(Date.parse(unredeemed.updateDate));
    });

    it('возврат после выкупа: причина словами (брак → предупреждение экрана), фасовка в артикуле', () => {
        const [line] = toReturnLines(buyout);
        expect(line).toEqual(
            expect.objectContaining({
                offerId: '527059-5',
                isBuyout: true,
                reason: 'брак: Диоды не соответствуют оригиналу',
                stateName: 'Возврат — забран магазином',
            }),
        );
    });

    it('в пути — без даты получения', () => {
        expect(toReturnLines(inTransit)[0].receivedAt).toBeNull();
    });

    it('несколько товаров в возврате — по строке на товар, id строки различаются', () => {
        const two = { ...unredeemed, items: [unredeemed.items[0], { shopSku: '492005', count: 2 }] };
        expect(toReturnLines(two).map((l) => [l.extId, l.units])).toEqual([
            ['123741939-539789', 1],
            ['123741939-492005', 2],
        ]);
    });

    it('список — только забранные с обновлением в окне', async () => {
        const { source } = make();
        const ids = async (from: string, to: string) =>
            (await source.listReceived(new Date(from), new Date(to))).map((l) => l.extId);
        expect(await ids('2026-10-07', '2026-10-22')).toEqual(['123741939']);
        expect(await ids('2026-08-01', '2026-10-22')).toEqual(['123741939', '27059326']);
    });

    it.each([
        ['коробка невыкупа', { kind: 'barcode', value: '62026013058-1' }],
        ['номер заказа', { kind: 'extId', value: '62026013058' }],
        ['id возврата', { kind: 'extId', value: '123741939' }],
    ] as const)('скан находит невыкуп по %s', async (_, scan) => {
        const { source } = make();
        expect((await source.find(scan)).map((l) => l.extId)).toEqual(['123741939']);
    });

    it('скан этикетки возврата VOZ_FBS_…', async () => {
        const { source } = make();
        expect((await source.find({ kind: 'barcode', value: 'VOZ_FBS_27059326' })).map((l) => l.posting)).toEqual([
            '58532670400',
        ]);
    });

    it('история постранично: идём по nextPageToken до конца, одно чтение на список и скан (кэш)', async () => {
        const { source, api } = make([ok([unredeemed], 'next'), ok([buyout])]);
        await source.listReceived(new Date('2026-08-01'), new Date('2026-10-22'));
        await source.find({ kind: 'extId', value: '27059326' });
        expect(api.method).toHaveBeenCalledTimes(2);
        expect(api.method.mock.calls[0][0]).toBe('campaigns/65613878/returns');
        expect(api.method.mock.calls[1][2]).toEqual(expect.objectContaining({ pageToken: 'next' }));
    });

    it('Яндекс не ответил (NotOk) — ошибка «не прочитаны», а не пустой список', async () => {
        const { source } = make([{ result: null, status: 'NotOk', error: { message: 'Unauthorized' } }]);
        await expect(source.listReceived(new Date('2026-10-01'), new Date('2026-10-22'))).rejects.toThrow(
            BadGatewayException,
        );
    });

    it('Яндекс не подключён (SERVICES) — пусто, к Яндексу не ходим', async () => {
        const { source, api } = make(undefined, ['ozon', 'wb']);
        expect(await source.listReceived(new Date('2026-10-01'), new Date('2026-10-22'))).toEqual([]);
        expect(await source.find({ kind: 'extId', value: '62026013058' })).toEqual([]);
        expect(api.method).not.toHaveBeenCalled();
    });
});

function ok(returns: YandexReturn[], nextPageToken?: string) {
    return { status: 'OK', result: { returns, paging: nextPageToken ? { nextPageToken } : {} } };
}
