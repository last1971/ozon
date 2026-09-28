import { NotifyRouteRepository } from './notify-route.repository';

describe('NotifyRouteRepository', () => {
    const transaction = { query: jest.fn(), commit: jest.fn(), rollback: jest.fn() };
    const pool = { getTransaction: jest.fn().mockResolvedValue(transaction) };
    let repo: NotifyRouteRepository;

    beforeEach(() => {
        transaction.query.mockReset();
        transaction.commit.mockReset().mockResolvedValue(undefined);
        transaction.rollback.mockReset().mockResolvedValue(undefined);
        pool.getTransaction.mockClear();
        repo = new NotifyRouteRepository(pool as any);
    });

    it('читает только ENABLED, режет пробелы Firebird, коммитит транзакцию', async () => {
        transaction.query.mockResolvedValue([
            { TOPIC: 'OPS   ', CHANNEL: 'matrix ', TARGET: '!a:s   ' },
            { TOPIC: 'ops', CHANNEL: 'mail', TARGET: 'x@y.z' },
            { TOPIC: 'DEV', CHANNEL: 'sms', TARGET: 'ignored' },
        ]);
        expect(await repo.targets('ops', 'matrix')).toEqual(['!a:s']);
        expect(await repo.targets('OPS', 'mail')).toEqual(['x@y.z']);
        expect(await repo.hasRoutes('DEV')).toBe(false);
        expect(transaction.query.mock.calls[0][0]).toContain('WHERE ENABLED = 1');
        expect(transaction.commit).toHaveBeenCalledWith(true);
        // кэш: три обращения — один запрос
        expect(pool.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('после invalidate перечитывает', async () => {
        transaction.query.mockResolvedValue([]);
        await repo.routes();
        repo.invalidate();
        await repo.routes();
        expect(pool.getTransaction).toHaveBeenCalledTimes(2);
    });

    it('ошибка базы → прошлый снимок, потом пусто; rollback вызван', async () => {
        transaction.query.mockResolvedValueOnce([{ TOPIC: 'DEV', CHANNEL: 'mail', TARGET: 'a@b.c' }]);
        expect(await repo.targets('DEV', 'mail')).toEqual(['a@b.c']);
        repo.invalidate();
        transaction.query.mockRejectedValueOnce(new Error('boom'));
        expect(await repo.targets('DEV', 'mail')).toEqual(['a@b.c']);
        expect(transaction.rollback).toHaveBeenCalled();
    });

    it('без пула — пусто', async () => {
        expect(await new NotifyRouteRepository(null).routes()).toEqual([]);
    });
});
