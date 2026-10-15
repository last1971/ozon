import { OzonReturnSource, toReturnLine } from './ozon.return.source';

const payload = {
    id: 1001644468,
    type: 'Cancellation',
    schema: 'Fbs',
    posting_number: '60350835-0906-1',
    order_number: '60350835-0906',
    return_reason_name: 'Покупатель отменил заказ: нашел дешевле',
    product: { offer_id: '538612', name: 'NUCLEO-F767ZI', quantity: 1 },
    logistic: { barcode: 'ii50029192978' },
    visual: {
        status: { sys_name: 'ReceivedBySeller', display_name: 'Получен' },
        change_moment: '2026-10-13T08:01:00Z',
    },
    additional_info: { is_opened: false },
};
const row = (state: string, extId = '1001644468') => ({
    extId,
    state,
    posting: '60350835-0906-1',
    firstSeen: new Date(),
    payload,
});

describe('OzonReturnSource', () => {
    const make = (rows: any[], live: any[] = []) => {
        const mpEvent = {
            findRows: jest.fn(async () => rows),
            listInState: jest.fn(async () => rows),
            record: jest.fn(),
        };
        const posting = { listReturnsByPostings: jest.fn(async () => live) };
        return { source: new OzonReturnSource(mpEvent as any, posting as any), mpEvent, posting };
    };

    it('запись Ozon → строка возврата', () => {
        expect(toReturnLine(payload, 'ReceivedBySeller')).toEqual(
            expect.objectContaining({
                extId: '1001644468',
                posting: '60350835-0906-1',
                offerId: '538612',
                units: 1,
                isBuyout: false,
                barcode: 'ii50029192978',
                receivedAt: '2026-10-13T08:01:00Z',
            }),
        );
    });

    it('штрихкод ищется в PAYLOAD журнала, одна строка на возврат', async () => {
        const { source, mpEvent } = make([row('ReceivedBySeller'), row('ArrivedAtReturnPlace')]);
        const res = await source.find({ kind: 'barcode', value: 'ii50029192978' });
        expect(mpEvent.findRows).toHaveBeenCalledWith('OZON', 'RETURN', { payloadContains: 'ii50029192978' });
        expect(res).toHaveLength(1);
    });

    it('номера отправления в журнале нет — живой запрос, в журнал не пишем', async () => {
        const { source, posting, mpEvent } = make([], [payload]);
        const res = await source.find({ kind: 'posting', value: '60350835-0906-1' });
        expect(posting.listReturnsByPostings).toHaveBeenCalledWith(['60350835-0906-1']);
        expect(res[0].extId).toBe('1001644468');
        expect(mpEvent.record).not.toHaveBeenCalled();
    });

    it('штрихкода в журнале нет — живьём не ищем', async () => {
        const { source, posting } = make([]);
        expect(await source.find({ kind: 'barcode', value: 'ii1' })).toEqual([]);
        expect(posting.listReturnsByPostings).not.toHaveBeenCalled();
    });
});
