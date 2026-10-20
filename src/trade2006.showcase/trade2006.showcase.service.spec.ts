import { Trade2006ShowcaseService } from './trade2006.showcase.service';

describe('Trade2006ShowcaseService — только чтение', () => {
    const query = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn().mockResolvedValue(undefined);
    const service = new Trade2006ShowcaseService({
        getTransaction: jest.fn().mockResolvedValue({ query, commit, rollback }),
    } as any);
    const since = new Date('2026-07-22T00:00:00');

    beforeEach(() => [query, commit, rollback].forEach((m) => m.mockClear()));

    it('остаток магазина — по сумме строк SHOPSKLAD, коды строкой', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 476318 }]);
        expect(await service.inShopStock()).toEqual(new Set(['476318']));
        expect(query.mock.calls[0][0]).toContain('HAVING SUM(QUAN) > 0');
    });

    it('первый приход — дата окна параметром, не CURRENT_DATE', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 551973, FIRST_IN: '2026-10-14T09:00:00' }]);
        const rows = await service.firstShopArrivals(since);
        expect(query.mock.calls[0][1]).toEqual([since]);
        expect(query.mock.calls[0][0]).not.toMatch(/CURRENT_DATE|'NOW'/);
        expect(rows).toEqual([{ code: '551973', firstIn: new Date('2026-10-14T09:00:00') }]);
    });

    it('приходы от поставщика: FOR_SHOP = 1, исключённые поставщики параметрами IN', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 562822, LAST_IN: '2026-10-19T00:00:00' }]);
        const rows = await service.lastSupplierArrivals(since, [1079, 1246, 2713]);
        expect(query.mock.calls[0][0]).toContain('FROM TRUEPRIH WHERE FOR_SHOP = 1 AND DATA >= ?');
        expect(query.mock.calls[0][0]).toContain('WHEREISPOSTCODE NOT IN (?, ?, ?)');
        expect(query.mock.calls[0][1]).toEqual([since, 1079, 1246, 2713]);
        expect(rows).toEqual([{ code: '562822', lastIn: new Date('2026-10-19T00:00:00') }]);
    });

    it('приходы без исключений — без NOT IN (пустой IN в Firebird — синтаксическая ошибка)', async () => {
        query.mockResolvedValueOnce([]);
        await service.lastSupplierArrivals(since, []);
        expect(query.mock.calls[0][0]).not.toContain('NOT IN');
        expect(query.mock.calls[0][1]).toEqual([since]);
    });

    it('продажи: касса и счета одной транзакцией, строки обоих источников, числа', async () => {
        query
            .mockResolvedValueOnce([{ GOODSCODE: 476318, SALES: 600, PIECES: 3000 }])
            .mockResolvedValueOnce([{ GOODSCODE: 476318, SALES: '433', PIECES: '2368' }]);
        const rows = await service.sales(since);
        expect(query.mock.calls[0][0]).toContain('FROM SHOPLOG');
        expect(query.mock.calls[0][0]).toContain('QUANSHOP > 0');
        expect(query.mock.calls[1][0]).toContain('COUNT(DISTINCT f.SFCODE)');
        expect(commit).toHaveBeenCalled();
        expect(rows).toEqual([
            { code: '476318', sales: 600, pieces: 3000 },
            { code: '476318', sales: 433, pieces: 2368 },
        ]);
    });

    it('продажи: ошибка — откат и проброс', async () => {
        query.mockRejectedValueOnce(new Error('lock'));
        await expect(service.sales(since)).rejects.toThrow('lock');
        expect(rollback).toHaveBeenCalled();
    });
});
