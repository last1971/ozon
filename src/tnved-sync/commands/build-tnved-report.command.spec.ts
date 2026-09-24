import { BuildTnvedReportCommand } from './build-tnved-report.command';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('BuildTnvedReportCommand', () => {
    const item = (offer: string, extra: Partial<ITnvedProcessingContext['items'][0]> = {}) => ({
        offer, goodscode: offer, current: null, base: 'x', markRequired: false, ok: false, ...extra,
    });

    it('делит решения на ок / на правку / спорно и переносит счётчики', async () => {
        const progress = emptyProgress();
        const res = await new BuildTnvedReportCommand().execute({
            progress,
            service: {} as any,
            opts: { market: GoodServiceEnum.WB, apply: true },
            base: [{ goodscode: '1', tnved: 'x', markRequired: false }, { goodscode: '2', tnved: 'x', markRequired: false }],
            skippedProcessed: 5,
            notFound: ['9'],
            items: [item('1', { ok: true }), item('2', { reason: 'ТНВЭД' }), item('3', { ambiguousReason: 'нет в справочнике' })],
        });

        expect(res.report).toMatchObject({
            apply: true,
            checkedGoods: 2,
            checkedOffers: 3,
            alreadyOk: 1,
            notFoundOnOzon: ['9'],
            ambiguous: [{ offer: '3', reason: 'нет в справочнике' }],
            skippedProcessed: 5,
            remaining: 0,
        });
        expect(res.report.toFix.map((f) => f.offer)).toEqual(['2']);
        expect(progress.counters).toEqual({ ok: 1, toFix: 1, ambiguous: 1, notFound: 1 });
    });
});
