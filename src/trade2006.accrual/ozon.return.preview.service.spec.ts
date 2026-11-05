import { EventEmitter } from 'events';
import { ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { MpEventService } from '../mp-event/mp-event.service';
import { OzonReturnPreviewService } from './ozon.return.preview.service';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';

const rawBlob = (text: string) => (_t: unknown, callback: Function) => {
    const emitter = new EventEmitter();
    callback(null, 'blob', emitter);
    queueMicrotask(() => {
        emitter.emit('data', Buffer.from(text));
        emitter.emit('end');
    });
};
const body = (id: number, amount: number) => ({
    accrual_id: id,
    date: '2026-10-01',
    unit_number: '111-222-1',
    accrued_category: 'POSTING',
    posting: { products: [{ sku: 101, quantity: 1, commission: { sale_amount: { amount: String(amount) } } }] },
});
const stored = (id: number, amount: number) => ({
    ACCRUAL_ID: String(id),
    RAW: rawBlob(JSON.stringify(body(id, amount))),
});

describe('OzonReturnPreviewService — чтение без записи', () => {
    const query = jest.fn();
    const t = {
        query,
        execute: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn().mockResolvedValue(undefined),
        transaction: {},
    };
    const pool = { getTransaction: jest.fn().mockResolvedValue(t) };
    const service = new OzonReturnPreviewService(
        pool as any,
        new Trade2006AccrualService(pool as any),
        new MpEventService(pool as any),
        new Trade2006InvoiceService(pool as any, null, null, null),
    );
    const catalog = new Map([['101', '501328-100']]);

    beforeEach(() => {
        jest.clearAllMocks();
        query.mockReset();
    });

    it('читает реальные BLOB-поля и все состояния возврата через существующий MpEventService', async () => {
        query.mockResolvedValueOnce([stored(1, 100), stored(2, -100)]).mockResolvedValueOnce([
            {
                EXT_ID: 'r',
                STATE: 'ReceivedBySeller',
                POSTING: '111-222-1',
                FIRST_SEEN: '2026-10-02T10:00:00Z',
                PAYLOAD: rawBlob(
                    JSON.stringify({
                        id: 'r',
                        posting_number: '111-222-1',
                        type: 'ClientReturn',
                        product: { sku: 101, offer_id: '501328-100', quantity: 1 },
                    }),
                ),
            },
        ]);
        const result = await service.preview('2026-08-07', '2026-11-05', catalog);
        expect(result.rows[0]).toEqual({ offerId: '501328-100', soldUnits: 1, paidReturnUnits: 1, returnPerc: 1 });
        expect(pool.getTransaction).toHaveBeenCalledWith(ISOLATION_READ_COMMITTED_READ_ONLY);
        const [sql, dates, autoCommit] = query.mock.calls[0];
        expect(sql).toContain('ACCRUAL_DATE >= ? AND ACCRUAL_DATE < ?');
        expect(sql).not.toMatch(/SETTLED_AT|VERDICT|AMOUNT [<>]|OZON_ACCRUAL_DAY/);
        expect(dates).toEqual(['2026-08-07', '2026-11-05']);
        expect(autoCommit).toBe(false);
        expect(query.mock.calls[1][1]).toEqual(['OZON', 'RETURN', '111-222-1']);
        expect(query.mock.calls.every(([statement]) => statement.startsWith('SELECT '))).toBe(true);
        expect(t.execute).not.toHaveBeenCalled();
        expect(t.commit).not.toHaveBeenCalled();
        expect(t.rollback).toHaveBeenCalledWith(true);
    });

    it('малый JSON читает из строки, не открывая BLOB отдельным запросом', async () => {
        const openBlob = jest.fn(() => {
            throw new Error('BLOB не должен открываться');
        });
        query.mockResolvedValueOnce([{ ACCRUAL_ID: '1', RAW_TEXT: JSON.stringify(body(1, 100)), RAW: openBlob }]);
        expect((await service.preview('2026-08-07', '2026-11-05', catalog)).rows[0].soldUnits).toBe(1);
        expect(openBlob).not.toHaveBeenCalled();
    });

    it('большой JSON читает полностью через общий readBlob', async () => {
        const full = { ...body(1, 100), extra: 'x'.repeat(10000) };
        query.mockResolvedValueOnce([{ ACCRUAL_ID: '1', RAW_TEXT: null, RAW: rawBlob(JSON.stringify(full)) }]);
        expect((await service.preview('2026-08-07', '2026-11-05', catalog)).rows[0].soldUnits).toBe(1);
    });

    it('без денежных сторно не перечитывает возвраты', async () => {
        query.mockResolvedValueOnce([stored(1, 100)]);
        expect((await service.preview('2026-08-07', '2026-11-05', catalog)).rows[0].returnPerc).toBe(0);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('при нескольких сторно одного отправления читает его возвраты один раз', async () => {
        query.mockResolvedValueOnce([stored(1, -100), stored(2, -100)]).mockResolvedValueOnce([]);
        await service.preview('2026-08-07', '2026-11-05', catalog);
        expect(query).toHaveBeenCalledTimes(2);
    });

    const unknownSale = (id = 1) => {
        const result = body(id, 236.19);
        delete result.posting.products[0].quantity;
        result.posting.products[0].commission = {
            sale_amount: { amount: '236.19' },
            seller_price: { amount: '235' },
        } as any;
        return { ACCRUAL_ID: String(id), RAW_TEXT: JSON.stringify(result) };
    };

    it('474561: 105 известных продаж + одна из закрытого счёта = 106 и 0%', async () => {
        const known = body(1, 24675);
        known.unit_number = 'other';
        known.posting.products[0].quantity = 105;
        query
            .mockResolvedValueOnce([{ ACCRUAL_ID: '1', RAW_TEXT: JSON.stringify(known) }, unknownSale(2)])
            .mockResolvedValueOnce([{ SCODE: 289772, NS: 66918, PRIM: '111-222-1 закрыт', STATUS: 5 }])
            .mockResolvedValueOnce([{ REALPRICECODE: 1, GOODSCODE: 474561, QUAN: 1, PIECES: null }]);
        const result = await service.preview('2026-08-07', '2026-11-05', new Map([['101', '474561']]));
        expect(result).toEqual({
            rows: [{ offerId: '474561', soldUnits: 106, paidReturnUnits: 0, returnPerc: 0 }],
            issues: [],
        });
        expect(query.mock.calls[1][1]).toEqual(['111-222-1', '111-222-1 ']);
        expect(query.mock.calls[2][1]).toEqual([289772]);
        expect(query.mock.calls.every((call) => call[2] === false)).toBe(true);
        expect(t.execute).not.toHaveBeenCalled();
        expect(t.commit).not.toHaveBeenCalled();
    });

    it.each([
        [],
        [{ SCODE: 1, PRIM: '111-222-1 отмена FBO', STATUS: 1 }],
        [
            { SCODE: 1, PRIM: '111-222-1', STATUS: 4 },
            { SCODE: 2, PRIM: '111-222-1 закрыт', STATUS: 5 },
        ],
    ])('нет однозначного действительного счёта — процент остаётся неизвестным', (...invoices) => {
        query.mockResolvedValueOnce([unknownSale()]).mockResolvedValueOnce(invoices);
        return service.preview('2026-08-07', '2026-11-05', catalog).then((result) => {
            expect(result.rows[0].returnPerc).toBeNull();
            expect(result.issues[0].reason).toBe('unknown-quantity');
            expect(query).toHaveBeenCalledTimes(2);
        });
    });

    it('счёт с неподходящим товаром не заполняет количество чужой строкой', async () => {
        query
            .mockResolvedValueOnce([unknownSale()])
            .mockResolvedValueOnce([{ SCODE: 1, PRIM: '111-222-1 закрыт', STATUS: 5 }])
            .mockResolvedValueOnce([{ GOODSCODE: 999999, QUAN: 1, PIECES: 1 }]);
        expect((await service.preview('2026-08-07', '2026-11-05', catalog)).rows[0].returnPerc).toBeNull();
    });

    it('ошибка чтения счёта не превращается в нулевой процент', async () => {
        query.mockResolvedValueOnce([unknownSale()]).mockRejectedValueOnce(new Error('invoice unavailable'));
        await expect(service.preview('2026-08-07', '2026-11-05', catalog)).rejects.toThrow('invoice unavailable');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });

    it('для неизвестного количества возврата не берёт полный состав продажи из счёта', async () => {
        const refund = body(1, -100.5);
        delete refund.posting.products[0].quantity;
        query.mockResolvedValueOnce([{ ACCRUAL_ID: '1', RAW_TEXT: JSON.stringify(refund) }]).mockResolvedValueOnce([]);
        await service.preview('2026-08-07', '2026-11-05', catalog);
        expect(query).toHaveBeenCalledTimes(2);
    });

    it('562821: три перепроведения дают 173 продажи вместо 176, пять настоящих возвратов сохраняются', async () => {
        const financial = (id: number, posting: string, direction = 1, units = 1) => {
            const money = (amount: number) => ({ amount: String(amount * direction), currency: 'RUB' });
            return {
                ...body(id, 2299 * units * direction),
                unit_number: posting,
                total_amount: money(1316.38 * units),
                posting: {
                    products: [
                        {
                            sku: 101,
                            quantity: units,
                            delivery: { total_accrued: money(-109 * units) },
                            commission: {
                                seller_price: money(2299),
                                sale_amount: money(2299 * units),
                                commission: money(-873.62 * units),
                            },
                        },
                    ],
                },
            };
        };
        const raw = [financial(1, 'base', 1, 170), financial(2, 'base', -1, 5)];
        for (let i = 0; i < 3; i++)
            raw.push(
                financial(10 + i * 3, `book-${i}`),
                financial(11 + i * 3, `book-${i}`, -1),
                financial(12 + i * 3, `book-${i}`),
            );
        query
            .mockResolvedValueOnce(raw.map((a) => ({ ACCRUAL_ID: String(a.accrual_id), RAW_TEXT: JSON.stringify(a) })))
            .mockResolvedValueOnce([
                {
                    EXT_ID: 'r',
                    STATE: 'ReceivedBySeller',
                    POSTING: 'base',
                    FIRST_SEEN: '2026-10-02T10:00:00Z',
                    PAYLOAD: rawBlob(
                        JSON.stringify({
                            id: 'r',
                            posting_number: 'base',
                            type: 'ClientReturn',
                            product: { sku: 101, offer_id: '562821', quantity: 5 },
                        }),
                    ),
                },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        const result = await service.preview('2026-08-07', '2026-11-05', new Map([['101', '562821']]));
        expect(result.issues).toEqual([]);
        expect(result.rows).toEqual([{ offerId: '562821', soldUnits: 173, paidReturnUnits: 5, returnPerc: 5 / 173 }]);
        expect(query).toHaveBeenCalledTimes(5);
        expect(t.execute).not.toHaveBeenCalled();
        expect(t.commit).not.toHaveBeenCalled();
    });

    it('ошибка чтения возвратов останавливает отчёт и закрывает транзакцию', async () => {
        query.mockResolvedValueOnce([stored(1, -100)]).mockRejectedValueOnce(new Error('return history unavailable'));
        await expect(service.preview('2026-08-07', '2026-11-05', catalog)).rejects.toThrow(
            'return history unavailable',
        );
        expect(t.rollback).toHaveBeenCalledWith(true);
    });

    it('повреждённый RAW останавливает отчёт, транзакция закрывается', async () => {
        query.mockResolvedValueOnce([{ ACCRUAL_ID: '1', RAW: rawBlob('invalid') }]);
        await expect(service.preview('2026-08-07', '2026-11-05', catalog)).rejects.toThrow('Не читается');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });

    it('несовпадение ID в RAW останавливает отчёт', async () => {
        query.mockResolvedValueOnce([{ ...stored(1, 100), ACCRUAL_ID: '2' }]);
        await expect(service.preview('2026-08-07', '2026-11-05', catalog)).rejects.toThrow('Не совпадает ID');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });

    it('ошибка БД не превращается в нулевую статистику', async () => {
        query.mockRejectedValueOnce(new Error('db unavailable'));
        await expect(service.preview('2026-08-07', '2026-11-05', catalog)).rejects.toThrow('db unavailable');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });

    it.each([
        ['2026-11-05', '2026-11-05'],
        ['2026-02-30', '2026-11-05'],
        ['bad', '2026-11-05'],
    ])('не открывает транзакцию при неверном периоде %s — %s', async (from, to) => {
        await expect(service.preview(from, to, catalog)).rejects.toThrow('период');
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
});
