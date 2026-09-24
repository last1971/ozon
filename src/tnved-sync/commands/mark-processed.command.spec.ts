import { MarkProcessedCommand } from './mark-processed.command';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('MarkProcessedCommand', () => {
    const save = jest.fn();
    const command = new MarkProcessedCommand({ save } as any);
    const good = (goodscode: string) => ({ goodscode, tnved: 'x', markRequired: false });
    const item = (offer: string, extra = {}) => ({ offer, goodscode: offer, current: null, base: 'x', markRequired: false, ok: false, ...extra });
    // all: 10 ок, 11 записан, 12 спорный, 13 нет карточки, 14 записан с ошибкой, 20 не в этом прогоне
    const ctx = (apply: boolean): ITnvedProcessingContext => ({
        progress: emptyProgress(),
        service: {} as any,
        opts: { market: GoodServiceEnum.OZON, apply },
        all: ['10', '11', '12', '13', '14', '20'].map(good),
        base: ['10', '11', '12', '13', '14'].map(good),
        processed: new Set<string>(['20']),
        items: [item('10', { ok: true }), item('11'), item('12', { ambiguousReason: 'спорно' }), item('14')],
        notFound: ['13'],
        report: {
            apply, checkedGoods: 5, checkedOffers: 4, alreadyOk: 1, notFoundOnOzon: ['13'], ambiguous: [], skippedProcessed: 0, remaining: 0,
            toFix: [item('11', { taskId: 1 }), item('14', { error: 'отказ' })],
        },
    });

    beforeEach(() => save.mockReset());

    it('apply: помечает ок и записанные без ошибки; спорные, с ошибкой, без карточки — нет; remaining по all', async () => {
        const res = await command.execute(ctx(true));

        expect(save).toHaveBeenCalledTimes(1);
        const [name, scope, set] = save.mock.calls[0];
        expect([name, scope]).toEqual(['tnved', 'ozon']);
        expect(Array.from(set as Set<string>).sort()).toEqual(['10', '11', '20']);
        expect(res.report.remaining).toBe(3); // 12, 13, 14
    });

    it('без apply: ничего не пишет, remaining считает по уже обработанным', async () => {
        const res = await command.execute(ctx(false));

        expect(save).not.toHaveBeenCalled();
        expect(res.report.remaining).toBe(5);
    });
});
