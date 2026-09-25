import { LoadWbTnvedCommand } from './load-wb-tnved.command';
import { IWbDictContext } from '../../interfaces/i.wb.dict.context';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('LoadWbTnvedCommand', () => {
    const subjectsToLoad = jest.fn();
    const saveTnved = jest.fn();
    const directory = jest.fn();
    const command = new LoadWbTnvedCommand({ subjectsToLoad, saveTnved } as any, { directory } as any);
    const ctx = (all = false): IWbDictContext => ({ all, days: 30, report: {}, progress: emptyProgress(), logger: { log: jest.fn(), error: jest.fn() } });
    const subject = (id: number) => ({ id, name: `предмет ${id}`, parentName: 'родитель', commission: 25 });

    beforeEach(() => [subjectsToLoad, saveTnved, directory].forEach((m) => m.mockReset()));

    it('справочник получен → записан, пустой → записан и посчитан отдельно, не отдан → пропущен', async () => {
        subjectsToLoad.mockResolvedValue([subject(1), subject(2), subject(3)]);
        directory
            .mockResolvedValueOnce([{ tnved: '8504408300', isKiz: true }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(null);

        const res = await command.execute(ctx());

        expect(saveTnved.mock.calls).toEqual([
            [1, [{ tnved: '8504408300', isKiz: true }]],
            [2, []],
        ]);
        expect(res.report).toEqual({ subjects: 3, saved: 1, empty: 1, failed: 1 });
        expect(res.progress.done).toBe(3);
        expect(res.progress.total).toBe(3);
    });

    it('all → в репозиторий уходит признак «все предметы» и срок устаревания', async () => {
        subjectsToLoad.mockResolvedValue([]);

        await command.execute(ctx(true));

        expect(subjectsToLoad).toHaveBeenCalledWith(true, 30);
        expect(directory).not.toHaveBeenCalled();
    });
});
