import { UpdateCardsCommand } from './update-cards.command';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('UpdateCardsCommand', () => {
    const update = jest.fn();
    const command = new UpdateCardsCommand();
    const fix = (offer: string) => ({
        offer,
        goodscode: offer,
        current: null,
        base: 'x',
        markRequired: false,
        ok: false,
    });
    const ctx = (apply: boolean, toFix = [fix('1'), fix('2')]): ITnvedProcessingContext => ({
        progress: emptyProgress(),
        service: { check: jest.fn(), update },
        opts: { market: GoodServiceEnum.WB, apply },
        progressCache: 'tnved',
        report: {
            apply,
            checkedGoods: 0,
            checkedOffers: 0,
            toFix,
            alreadyOk: 0,
            notFoundOnOzon: [],
            ambiguous: [],
            skippedProcessed: 0,
            remaining: 0,
        },
    });

    beforeEach(() => update.mockReset());

    it('без apply — не пишет', async () => {
        await command.execute(ctx(false));

        expect(update).not.toHaveBeenCalled();
    });

    it('apply без «на правку» — не пишет', async () => {
        await command.execute(ctx(true, []));

        expect(update).not.toHaveBeenCalled();
    });

    it('apply — пишет «на правку», итог по карточке в отчёт (taskId / error)', async () => {
        update.mockResolvedValue([
            { offer: '1', taskId: 7 },
            { offer: '2', error: 'отказ' },
        ]);
        const c = ctx(true);

        const res = await command.execute(c);

        expect(update).toHaveBeenCalledWith(c.report.toFix, c.progress);
        expect(res.report.toFix).toMatchObject([
            { offer: '1', taskId: 7 },
            { offer: '2', error: 'отказ' },
        ]);
        expect(c.progress.counters.writeErrors).toBe(1);
    });
});
