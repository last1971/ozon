import { LoadBaseTnvedCommand } from './load-base-tnved.command';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('LoadBaseTnvedCommand', () => {
    const query = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const pool = { getTransaction: jest.fn().mockResolvedValue({ query, commit, rollback }) };
    const command = new LoadBaseTnvedCommand(pool as any);
    const ctx = (offer?: string): ITnvedProcessingContext => ({ progress: emptyProgress(), service: {} as any, opts: { market: GoodServiceEnum.WB, offer } });

    beforeEach(() => [query, commit, rollback].forEach((m) => m.mockReset()));

    it('все товары с ТН ВЭД → ctx.all, строки нормализованы', async () => {
        query.mockResolvedValue([{ GOODSCODE: 565831, TNVED: ' 8504408300 ', MARK_REQUIRED: 1 }, { GOODSCODE: 376743, TNVED: '8532220000', MARK_REQUIRED: 0 }]);

        const res = await command.execute(ctx());

        expect(res.all).toEqual([
            { goodscode: '565831', tnved: '8504408300', markRequired: true },
            { goodscode: '376743', tnved: '8532220000', markRequired: false },
        ]);
        expect(query.mock.calls[0][0]).not.toContain('GOODSCODE = ?');
        expect(query.mock.calls[0][1]).toEqual([]);
        expect(commit).toHaveBeenCalled();
    });

    it('opts.offer → фильтр по одному goodscode', async () => {
        query.mockResolvedValue([]);

        await command.execute(ctx('565831'));

        expect(query.mock.calls[0][0]).toContain('GOODSCODE = ?');
        expect(query.mock.calls[0][1]).toEqual([565831]);
    });

    it('ошибка запроса → rollback и исключение наружу', async () => {
        query.mockRejectedValue(new Error('boom'));

        await expect(command.execute(ctx())).rejects.toThrow('boom');
        expect(rollback).toHaveBeenCalled();
    });
});
