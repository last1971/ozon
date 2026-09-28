import { LoadBaseGtinCommand } from './load-base-gtin.command';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';
import { CardSyncMode, ICardSyncContext } from '../../interfaces/i.card.sync';
import { GtinBaseItem, GtinCheckItem } from '../../interfaces/i.gtin.sync';

describe('LoadBaseGtinCommand', () => {
    const query = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const pool = { getTransaction: jest.fn().mockResolvedValue({ query, commit, rollback }) };
    const command = new LoadBaseGtinCommand(pool as any);
    const ctx = (offer?: string): ICardSyncContext<GtinBaseItem, GtinCheckItem> => ({
        progress: emptyProgress(),
        service: {} as any,
        opts: { mode: CardSyncMode.GTIN, market: GoodServiceEnum.OZON, offer },
        progressCache: 'gtin',
    });

    beforeEach(() => [query, commit, rollback].forEach((m) => m.mockReset()));

    it('все непустые GTIN товара (свой и поставщиков) → одна строка на товар, ключ прогресса = товар + набор GTIN', async () => {
        query.mockResolvedValue([
            { GOODSCODE: 569593, GTIN: '04600000000011' },
            { GOODSCODE: 569593, GTIN: '04600000000028' },
            { GOODSCODE: 569593, GTIN: '04600000000011' }, // дубль строки — не дублируем
            { GOODSCODE: 12, GTIN: ' 00400001759547 ' },
        ]);

        const res = await command.execute(ctx());

        expect(res.all).toEqual([
            {
                goodscode: '569593',
                gtins: ['04600000000011', '04600000000028'],
                progressKey: '569593:04600000000011|04600000000028',
            },
            { goodscode: '12', gtins: ['00400001759547'], progressKey: '12:00400001759547' },
        ]);
        const sql: string = query.mock.calls[0][0];
        expect(sql).toContain("GTIN IS NOT NULL AND TRIM(c.GTIN) <> ''");
        expect(sql).not.toContain('IS_PRIMARY'); // все GTIN, без фильтра по своим/поставщикам
        expect(sql).not.toContain('GOODSCODE = ?');
        expect(commit).toHaveBeenCalled();
    });

    it('opts.offer → фильтр по одному товару', async () => {
        query.mockResolvedValue([]);

        await command.execute(ctx('569593'));

        expect(query.mock.calls[0][0]).toContain('GOODSCODE = ?');
        expect(query.mock.calls[0][1]).toEqual([569593]);
    });

    it('ошибка запроса → откат и проброс', async () => {
        query.mockRejectedValue(new Error('fb'));

        await expect(command.execute(ctx())).rejects.toThrow('fb');
        expect(rollback).toHaveBeenCalled();
    });
});
