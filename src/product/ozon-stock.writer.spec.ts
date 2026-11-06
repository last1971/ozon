import { OzonStockWriter } from './ozon-stock.writer';
const ok = (stocks: any[]) => ({ result: stocks.map((s) => ({ ...s, updated: true, errors: [] })) });
describe('Очередь остатков Ozon', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());
    it('объединяет обновления пары, отдаёт явный superseded вместо ложного успеха', async () => {
        const send = jest.fn(async (rows) => ok(rows));
        const writer = new OzonStockWriter(send);
        const a = writer.update([{ offer_id: 'a', warehouse_id: 1, stock: 5 }]);
        const b = writer.update([{ offer_id: 'a', warehouse_id: 1, stock: 0 }]);
        await jest.advanceTimersByTimeAsync(0);
        expect(send).toHaveBeenCalledWith([{ offer_id: 'a', warehouse_id: 1, stock: 0 }]);
        expect((await a).result[0]).toMatchObject({ updated: false, superseded: true });
        expect((await b).result[0].updated).toBe(true);
    });
    it('после ограничения повторяет последнее значение, другое SKU не ждёт 30 секунд', async () => {
        const send = jest
            .fn()
            .mockResolvedValueOnce({
                result: [{ offer_id: 'a', updated: false, errors: [{ code: 'TOO_MANY_REQUESTS' }] }],
            })
            .mockImplementation(async (rows) => ok(rows));
        const writer = new OzonStockWriter(send);
        const a = writer.update([{ offer_id: 'a', stock: 3 }]);
        await jest.advanceTimersByTimeAsync(0);
        const b = writer.update([
            { offer_id: 'a', stock: 0 },
            { offer_id: 'b', stock: 2 },
        ]);
        await jest.advanceTimersByTimeAsync(800);
        expect(send.mock.calls[1][0]).toEqual([{ offer_id: 'b', stock: 2 }]);
        await jest.advanceTimersByTimeAsync(29200);
        expect(send.mock.calls[2][0]).toEqual([{ offer_id: 'a', stock: 0 }]);
        expect((await a).result[0].superseded).toBe(true);
        expect((await b).result.every((r) => r.updated)).toBe(true);
    });
    it('повторы ограничены, окончательный отказ не теряется', async () => {
        const send = jest
            .fn()
            .mockResolvedValue({ result: [{ offer_id: 'a', updated: false, errors: ['TOO_MANY_REQUESTS'] }] });
        const result = new OzonStockWriter(send).update([{ offer_id: 'a', stock: 1 }]);
        await jest.advanceTimersByTimeAsync(60000);
        expect(send).toHaveBeenCalledTimes(3);
        expect((await result).result[0].updated).toBe(false);
    });
    it('ошибка сети и пустой ответ не выдаются за успех, следующая отправка работает', async () => {
        const send = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
        const writer = new OzonStockWriter(send);
        const first = writer.update([{ offer_id: 'a', stock: 1 }]);
        await jest.advanceTimersByTimeAsync(0);
        expect((await first).result[0].errors[0]).toMatchObject({ code: 'REQUEST_FAILED' });
        const second = writer.update([{ offer_id: 'b', stock: 1 }]);
        await jest.advanceTimersByTimeAsync(800);
        expect((await second).result[0].updated).toBe(false);
    });
    it('разбивает 101 пару на 100 + 1, разные склады не склеиваются', async () => {
        const send = jest.fn(async (rows) => ok(rows));
        const writer = new OzonStockWriter(send);
        const result = writer.update(
            Array.from({ length: 101 }, (_, warehouse_id) => ({ warehouse_id, offer_id: 'a', stock: 1 })),
        );
        await jest.advanceTimersByTimeAsync(800);
        expect(send.mock.calls.map(([rows]) => rows.length)).toEqual([100, 1]);
        expect((await result).result).toHaveLength(101);
    });
});

describe('Остатки Ozon: ответ по складам и изменения во время запроса', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());
    it('ответ другого склада не засчитывается как успех', async () => {
        const send = jest
            .fn()
            .mockResolvedValue({ result: [{ offer_id: 'a', warehouse_id: 1, updated: true, errors: [] }] });
        const result = new OzonStockWriter(send).update([
            { offer_id: 'a', warehouse_id: 1, stock: 2 },
            { offer_id: 'a', warehouse_id: 2, stock: 3 },
        ]);
        await jest.advanceTimersByTimeAsync(0);
        expect((await result).result.map((r) => r.updated)).toEqual([true, false]);
    });
    it('ответ без склада для нескольких складов одного товара неоднозначен', async () => {
        const send = jest.fn().mockResolvedValue({ result: [{ offer_id: 'a', updated: true, errors: [] }] });
        const result = new OzonStockWriter(send).update([
            { offer_id: 'a', warehouse_id: 1, stock: 2 },
            { offer_id: 'a', warehouse_id: 2, stock: 3 },
        ]);
        await jest.advanceTimersByTimeAsync(0);
        expect((await result).result.every((r) => !r.updated)).toBe(true);
    });
    it('новое значение во время запроса уходит после паузы, запросы не пересекаются', async () => {
        let complete: (value: any) => void;
        const send = jest
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        complete = resolve;
                    }),
            )
            .mockImplementation(async (rows) => ok(rows));
        const writer = new OzonStockWriter(send);
        const first = writer.update([{ offer_id: 'a', stock: 5 }]);
        await jest.advanceTimersByTimeAsync(0);
        const next = writer.update([{ offer_id: 'a', stock: 0 }]);
        await jest.advanceTimersByTimeAsync(1000);
        expect(send).toHaveBeenCalledTimes(1);
        complete(ok([{ offer_id: 'a', stock: 5 }]));
        await first;
        await jest.advanceTimersByTimeAsync(28999);
        expect(send).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect((await next).result[0].updated).toBe(true);
        expect(send.mock.calls[1][0][0].stock).toBe(0);
    });
    it('HTTP 429 из клиента повторяется, успешно отправленные строки повторно не посылаются', async () => {
        const send = jest
            .fn()
            .mockResolvedValueOnce({ error: { status: 429, message: 'limit' } })
            .mockImplementation(async (rows) => ok(rows));
        const result = new OzonStockWriter(send).update([{ offer_id: 'a', stock: 0 }]);
        await jest.advanceTimersByTimeAsync(30000);
        expect(send).toHaveBeenCalledTimes(2);
        expect((await result).result[0].updated).toBe(true);
    });
    it('пустой список не вызывает API', async () => {
        const send = jest.fn();
        expect(await new OzonStockWriter(send).update([])).toEqual({ result: [] });
        await jest.runAllTimersAsync();
        expect(send).not.toHaveBeenCalled();
    });
});
