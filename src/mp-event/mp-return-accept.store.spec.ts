import { ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { MpReturnAcceptStore } from './mp-return-accept.store';

describe('Чтение подтверждённых списаний возвратов', () => {
    function setup() {
        const t = {
            query: jest.fn().mockResolvedValue([
                {
                    ID: 7,
                    SERVICE: 'WB',
                    GOODSCODE: 123,
                    UNITS: 1,
                    PIECES: 10,
                    QUAN: 10,
                    SPIS_CODE: 42,
                    SPIS_SS: 1,
                    SPIS_AT: new Date('2026-10-01'),
                    DOC_QUAN: 10,
                },
            ]),
            rollback: jest.fn(),
        };
        const pool = { getTransaction: jest.fn().mockResolvedValue(t) };
        return { t, pool, store: new MpReturnAcceptStore(pool as any) };
    }
    it('читает существующие документы, ограничивает площадку/период, освобождает read-only транзакцию', async () => {
        const { store, pool, t } = setup();
        expect(await store.listRecordedWriteOffs('WB', '2026-08-08', '2026-11-06')).toEqual([
            expect.objectContaining({ id: 7, service: 'WB', units: 1, pieces: 10, quan: 10, documentQuantity: 10 }),
        ]);
        expect(pool.getTransaction).toHaveBeenCalledWith(ISOLATION_READ_COMMITTED_READ_ONLY);
        const [sql, params, detach] = t.query.mock.calls[0];
        expect(sql).toContain("A.DECISION = 'RETURN'");
        expect(sql).toContain('SPISSHOP');
        expect(sql).toContain('SPISSKLAD');
        expect(params).toEqual(['WB', new Date('2026-08-08T00:00:00+03:00'), new Date('2026-11-06T00:00:00+03:00')]);
        expect(detach).toBe(false);
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('не превращает отсутствие документа в ноль', async () => {
        const { store, t } = setup();
        t.query.mockResolvedValue([{ ID: 7, SERVICE: 'WB', DOC_QUAN: null }]);
        expect((await store.listRecordedWriteOffs('WB', '2026-08-08', '2026-11-06'))[0].documentQuantity).toBeNull();
    });
    it('ошибка чтения не выдаётся за пустую историю; транзакция освобождена', async () => {
        const { store, t } = setup();
        t.query.mockRejectedValue(new Error('database unavailable'));
        await expect(store.listRecordedWriteOffs('WB', '2026-08-08', '2026-11-06')).rejects.toThrow('database');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('не открывает транзакцию для неверного периода', async () => {
        const { store, pool } = setup();
        await expect(store.listRecordedWriteOffs('WB', '2026-11-06', '2026-11-06')).rejects.toThrow();
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
});
