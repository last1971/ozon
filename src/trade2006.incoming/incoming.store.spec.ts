import { IncomingStore } from './incoming.store';

/** Транзакция как у драйвера: после commit — «Invalid transaction handle», query(..., true) коммитит сам. */
const driverTransaction = (rows: any[]) => {
    let open = true;
    const closed = () => {
        if (!open) throw new Error('Invalid transaction handle (expecting explicit transaction start)');
        open = false;
    };
    return {
        query: jest.fn(async (_sql: string, _params: any[], autoCommit = false) => {
            if (!open) throw new Error('Invalid transaction handle (expecting explicit transaction start)');
            if (autoCommit) closed();
            return rows;
        }),
        commit: jest.fn(async () => closed()),
        rollback: jest.fn(async () => undefined),
    };
};

describe('IncomingStore', () => {
    const make = (storageType: string, rows: any[]) => {
        const t = driverTransaction(rows);
        const pool = { getTransaction: jest.fn(async () => t) };
        return { store: new IncomingStore(pool as any, { get: () => storageType } as any), t };
    };

    it('коды прихода — одна транзакция, один коммит (двойной ронял пересчёт цен с 17.10.2026)', async () => {
        const { store, t } = make('SKLAD', [{ GOODSCODE: 101 }, { GOODSCODE: 102 }]);
        await expect(store.goodsOfPrihods(['65147', '65146'])).resolves.toEqual(['101', '102']);
        expect(t.commit).toHaveBeenCalledTimes(1);
        expect(t.query.mock.calls[0][0]).toContain('FROM SKLADIN');
    });

    it('магазин — SHOPIN, номер прихода числом', async () => {
        const { store, t } = make('SHOPSKLAD', [{ GOODSCODE: 7 }]);
        await store.goodsOfPrihods(['123']);
        expect(t.query.mock.calls[0][0]).toContain('FROM SHOPIN');
        expect(t.query.mock.calls[0][1]).toEqual([123]);
    });
});
