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
        const { store, t } = make('SKLAD', [
            { NP: '65147', GOODSCODE: 101 },
            { NP: '65146', GOODSCODE: 102 },
            { NP: '65146', GOODSCODE: 101 },
        ]);
        await expect(store.goodsByPrihod(['65147', '65146'])).resolves.toEqual(
            new Map([
                ['65147', ['101']],
                ['65146', ['102', '101']],
            ]),
        );
        expect(t.commit).toHaveBeenCalledTimes(1);
        expect(t.query.mock.calls[0][0]).toContain('FROM SKLADIN');
    });

    it('магазин — SHOPIN, номер прихода числом', async () => {
        const { store, t } = make('SHOPSKLAD', [{ NP: 123, GOODSCODE: 7 }]);
        await expect(store.goodsByPrihod(['123'])).resolves.toEqual(new Map([['123', ['7']]]));
        expect(t.query.mock.calls[0][0]).toContain('FROM SHOPIN');
        expect(t.query.mock.calls[0][1]).toEqual([123]);
    });
});
