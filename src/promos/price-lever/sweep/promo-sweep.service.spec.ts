import { PromoSweepService } from './promo-sweep.service';
import { PROMO_SWEEP_JOB } from './promo-sweep.context';

describe('PromoSweepService — запуск сверки фоновой задачей', () => {
    it('команды по порядку, kind и params для идемпотентности, отчёт — из контекста', () => {
        const run = jest.fn().mockReturnValue({ id: 'j1' });
        const [collect, plan, apply, report] = [{ c: 1 }, { c: 2 }, { c: 3 }, { c: 4 }] as any[];
        const svc = new PromoSweepService({ run } as any, collect, plan, apply, report);

        expect(svc.start(true, 'min', 'browser')).toEqual({ id: 'j1' });
        const opts = run.mock.calls[0][0];
        expect(opts).toMatchObject({
            kind: PROMO_SWEEP_JOB,
            params: { apply: true, goal: 'min' },
            clientId: 'browser',
        });
        expect(opts.commands).toEqual([collect, plan, apply, report]);
        expect(opts.context).toMatchObject({ apply: true, goal: 'min', progress: { done: 0, counters: {} } });
        expect(opts.result({ report: { selected: 3 } })).toEqual({ selected: 3 });
    });
});
