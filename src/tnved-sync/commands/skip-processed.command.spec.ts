import { SkipProcessedCommand } from './skip-processed.command';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';

describe('SkipProcessedCommand', () => {
    const load = jest.fn();
    const command = new SkipProcessedCommand({ load } as any);
    const all = ['1', '2', '3'].map((goodscode) => ({ goodscode, tnved: 'x', markRequired: false }));
    const ctx = (opts: Partial<ITnvedProcessingContext['opts']>): ITnvedProcessingContext => ({
        service: {} as any,
        opts: { market: GoodServiceEnum.OZON, ...opts },
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
});
