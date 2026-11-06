import { OzonReturnStore } from './ozon.return.store';
import { calculateLossRates, lossPeriod } from '../helpers/price/marketplace.loss.stats';
import { LossSnapshot } from '../marketplace-loss/loss.contracts';
import { ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';

const at = new Date('2026-11-05T02:38:00Z');
const row = (offerId = '123-5') => ({
    offerId,
    soldUnits: 3,
    returnedUnits: 1,
    writtenOffUnits: 0,
    ...calculateLossRates({ soldUnits: 3, returnedUnits: 1, writtenOffUnits: 0 }),
    appliedReturnRate: 0.333333,
});
const snapshot = (): LossSnapshot => ({
    service: 'OZON',
    calculatedAt: at,
    period: lossPeriod(at),
    preliminary: false,
    rows: [row()],
});
const setup = () => {
    const t = {
        query: jest.fn().mockResolvedValue([]),
        execute: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    const pool = { getTransaction: jest.fn().mockResolvedValue(t) };
    return { t, pool, store: new OzonReturnStore(pool as any) };
};
describe('Ozon использует единое хранилище, настройки остаются в OZON_PERC', () => {
    it('пишет фактическую и применяемую долю отдельно; наценки и старые проценты не трогает', async () => {
        const { store, t } = setup();
        await store.replace(snapshot());
        const inserts = t.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
        expect(inserts).toHaveLength(1);
        expect(inserts[0][1]).toEqual(['OZON', 123, 5, 3, 1, 0, 1 / 3, 0, 'READY', at, 0.333333]);
        expect(t.execute.mock.calls.every(([sql]) => !sql.includes('OZON_PERC'))).toBe(true);
        expect(t.commit).toHaveBeenCalledWith(true);
        expect(t.rollback).not.toHaveBeenCalled();
    });
    it('подготовленный политикой резерв не подменяет собственную статистику', async () => {
        const { store, t } = setup();
        const data = snapshot();
        data.rows[0].appliedReturnRate = 0.05;
        await store.replace(data);
        const args = t.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT'))[1];
        expect(args[6]).toBe(1 / 3);
        expect(args[10]).toBe(0.05);
    });
    it.each(['query', 'execute', 'commit'])('сбой %s откатывает снимок', async (method) => {
        const { store, t } = setup();
        t[method].mockRejectedValueOnce(Error('failure'));
        await expect(store.replace(snapshot())).rejects.toThrow('failure');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('ошибка второй строки откатывает удаление и первую вставку', async () => {
        const { store, t } = setup();
        let inserted = 0;
        t.execute.mockImplementation(async (sql) => {
            if (sql.startsWith('INSERT') && ++inserted === 2) throw Error('second');
        });
        await expect(store.replace({ ...snapshot(), rows: [row(), row('124')] })).rejects.toThrow('second');
        expect(t.commit).not.toHaveBeenCalled();
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('старый снимок не перезаписывает новый', async () => {
        const { store, t } = setup();
        t.query.mockResolvedValue([{ CALCULATED_AT: new Date(at.getTime() + 1) }]);
        await expect(store.replace(snapshot())).rejects.toThrow('более новый');
        expect(t.execute.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
    });
    it('пустой каталог не стирает статистику Ozon', async () => {
        const { store, pool } = setup();
        await expect(store.replace({ ...snapshot(), rows: [] })).rejects.toThrow('непустой');
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it.each([-1, 1.1, NaN, Infinity, null, undefined])(
        'не открывает запись при применяемой доле %s',
        async (appliedReturnRate) => {
            const { store, pool } = setup();
            await expect(store.replace({ ...snapshot(), rows: [{ ...row(), appliedReturnRate }] })).rejects.toThrow();
            expect(pool.getTransaction).not.toHaveBeenCalled();
        },
    );
    it('не открывает запись при дубликате, неверной дате, площадке или ключе', async () => {
        const { store, pool } = setup();
        for (const patch of [
            { rows: [row(), row()] },
            { calculatedAt: new Date(NaN) },
            { service: 'WB' },
            { rows: [row('123-0')] },
        ])
            await expect(store.replace({ ...snapshot(), ...patch })).rejects.toThrow();
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it('читает известные фасовки из настроек и предыдущего снимка в read-only транзакции', async () => {
        const { store, pool, t } = setup();
        t.query.mockResolvedValue([
            { GOODSCODE: 123, PIECES: 1 },
            { GOODSCODE: 123, PIECES: 5 },
        ]);
        expect(await store.listKnownOffers()).toEqual(['123', '123-5']);
        expect(pool.getTransaction).toHaveBeenCalledWith(ISOLATION_READ_COMMITTED_READ_ONLY);
        expect(t.query.mock.calls[0][0]).toContain("WHERE SERVICE = 'OZON'");
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('ошибка чтения известных фасовок освобождает транзакцию', async () => {
        const { store, t } = setup();
        t.query.mockRejectedValue(Error('read'));
        await expect(store.listKnownOffers()).rejects.toThrow('read');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
});
