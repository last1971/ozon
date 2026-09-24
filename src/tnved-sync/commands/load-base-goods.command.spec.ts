import { LoadBaseGoodsCommand } from './load-base-goods.command';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('LoadBaseGoodsCommand', () => {
    const query = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const pool = { getTransaction: jest.fn().mockResolvedValue({ query, commit, rollback }) };
    const command = new LoadBaseGoodsCommand(pool as any);
    const ctx = () => ({ progress: emptyProgress(), market: GoodServiceEnum.WB, service: {} as any });

    beforeEach(() => [query, commit, rollback].forEach((m) => m.mockReset()));

    it('все коды и коды с ТН ВЭД, если GOODS_CLASSIF есть', async () => {
        query
            .mockResolvedValueOnce([{ GOODSCODE: 1 }, { GOODSCODE: 2 }])
            .mockResolvedValueOnce([{ X: 1 }])
            .mockResolvedValueOnce([{ GOODSCODE: 2 }]);

        const res = await command.execute(ctx());

        expect(res.allGoods).toEqual(new Set(['1', '2']));
        expect(res.withTnved).toEqual(new Set(['2']));
        expect(query.mock.calls[2][0]).toContain('GOODS_CLASSIF');
        expect(commit).toHaveBeenCalled();
    });

    it('GOODS_CLASSIF нет → «с ТН ВЭД» пусто, запрос к таблице не идёт', async () => {
        query.mockResolvedValueOnce([{ GOODSCODE: 1 }]).mockResolvedValueOnce([]);

        const res = await command.execute(ctx());

        expect(res.withTnved).toEqual(new Set());
        expect(query).toHaveBeenCalledTimes(2);
    });

    it('ошибка → rollback и исключение', async () => {
        query.mockRejectedValue(new Error('boom'));

        await expect(command.execute(ctx())).rejects.toThrow('boom');
        expect(rollback).toHaveBeenCalled();
    });
});
