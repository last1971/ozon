import { SkipProcessedCommand } from './skip-processed.command';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('SkipProcessedCommand', () => {
    const load = jest.fn();
    const command = new SkipProcessedCommand({ load } as any);
    const all = ['1', '2', '3'].map((goodscode) => ({ goodscode, tnved: 'x', markRequired: false }));
    const ctx = (opts: Partial<ITnvedProcessingContext['opts']>): ITnvedProcessingContext => ({
        progress: emptyProgress(),
        service: {} as any,
        opts: { market: GoodServiceEnum.OZON, ...opts },
        progressCache: 'tnved',
        all,
    });

    beforeEach(() => load.mockReset().mockResolvedValue(new Set(['1'])));

    it('без onlyNew — вся база, обработанные не пропускаются', async () => {
        const res = await command.execute(ctx({}));

        expect(load).toHaveBeenCalledWith('tnved', 'ozon');
        expect(res.base.map((b) => b.goodscode)).toEqual(['1', '2', '3']);
        expect(res.skippedProcessed).toBe(0);
    });

    it('onlyNew — обработанные выкинуты, limit режет уже отфильтрованное', async () => {
        const res = await command.execute(ctx({ onlyNew: true, limit: 1 }));

        expect(res.base.map((b) => b.goodscode)).toEqual(['2']);
        expect(res.skippedProcessed).toBe(1);
        expect(res.processed).toEqual(new Set(['1']));
    });

    it('ключ обработанного — progressKey строки, если задан (режим GTIN: товар + набор GTIN)', async () => {
        load.mockResolvedValue(new Set(['2:111']));
        const c = ctx({ onlyNew: true });
        c.all = [
            { goodscode: '1', progressKey: '1:999', tnved: 'x', markRequired: false },
            { goodscode: '2', progressKey: '2:111', tnved: 'x', markRequired: false },
        ];
        c.progressCache = 'gtin';

        const res = await command.execute(c);

        expect(load).toHaveBeenCalledWith('gtin', 'ozon');
        expect(res.base.map((b) => b.goodscode)).toEqual(['1']);
    });
});
