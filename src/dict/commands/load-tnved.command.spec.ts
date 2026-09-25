import { LoadTnvedCommand } from './load-tnved.command';
import { IDictContext } from '../../interfaces/i.tnved.dictionary';
import { emptyProgress } from '../../interfaces/i.job.context';
import { GoodServiceEnum } from '../../good/good.service.enum';

describe('LoadTnvedCommand', () => {
    const subjectsToLoad = jest.fn();
    const saveTnved = jest.fn();
    const directory = jest.fn();
    const service = { market: GoodServiceEnum.WB, subjectsToLoad, saveTnved, directory } as any;
    const command = new LoadTnvedCommand();
    const ctx = (all = false): IDictContext => ({
        service,
        all,
        days: 30,
        report: { market: GoodServiceEnum.WB },
        progress: emptyProgress(),
        logger: { log: jest.fn(), error: jest.fn() },
    });
    const subject = (id: number) => ({ id, name: `предмет ${id}`, parentName: 'родитель', commission: 25 });

    beforeEach(() => [subjectsToLoad, saveTnved, directory].forEach((m) => m.mockReset()));

    it('справочник получен → записан, пустой → записан и посчитан отдельно, не отдан → пропущен', async () => {
        subjectsToLoad.mockResolvedValue([subject(1), subject(2), subject(3)]);
        directory
            .mockResolvedValueOnce([{ tnved: '8504408300', isKiz: true }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(null);

        const res = await command.execute(ctx());

        expect(directory.mock.calls.map((c) => c[0].id)).toEqual([1, 2, 3]);
        expect(saveTnved.mock.calls).toEqual([
            [1, [{ tnved: '8504408300', isKiz: true }]],
            [2, []],
        ]);
        expect(res.report).toEqual({ market: GoodServiceEnum.WB, subjects: 3, saved: 1, empty: 1, failed: 1 });
        expect(res.progress.done).toBe(3);
        expect(res.progress.total).toBe(3);
    });

    it('all → в реализацию уходит признак «все предметы» и срок устаревания', async () => {
        subjectsToLoad.mockResolvedValue([]);

        await command.execute(ctx(true));

        expect(subjectsToLoad).toHaveBeenCalledWith(true, 30);
        expect(directory).not.toHaveBeenCalled();
    });
});
