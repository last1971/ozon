import { NotifySweepCommand, OZON_PROMO_SWEEP_EVENT } from './notify-sweep.command';

describe('NotifySweepCommand — уведомление о применённой сверке', () => {
    const emit = jest.fn();
    const cmd = new NotifySweepCommand({ emit } as any);
    const ctx = (over: any) => ({ progress: { done: 0, counters: {} }, report: { selected: 1 }, ...over });
    beforeEach(() => emit.mockReset());

    it('применили и хоть один прошёл — событие с отчётом', async () => {
        await cmd.execute(ctx({ apply: true, results: [{ applied: false }, { applied: true }] }));
        expect(emit).toHaveBeenCalledWith(OZON_PROMO_SWEEP_EVENT, { selected: 1 });
    });

    it('проверка без применения или ничего не прошло — молчим', async () => {
        await cmd.execute(ctx({ apply: false, results: [{ applied: true }] }));
        await cmd.execute(ctx({ apply: true, results: [{ applied: false }] }));
        await cmd.execute(ctx({ apply: true }));
        expect(emit).not.toHaveBeenCalled();
    });

    it('все шаги уже стояли (changed: false) — молчим', async () => {
        const unchanged = { applied: true, results: [{ step: {}, status: 'ok', reason: 'уже стоит', changed: false }] };
        await cmd.execute(ctx({ apply: true, results: [unchanged, unchanged] }));
        expect(emit).not.toHaveBeenCalled();
    });

    it('часть шагов реально изменена — событие', async () => {
        const changed   = { applied: true, results: [{ step: {}, status: 'ok', changed: true }] };
        const unchanged = { applied: true, results: [{ step: {}, status: 'ok', changed: false }] };
        await cmd.execute(ctx({ apply: true, results: [unchanged, changed] }));
        expect(emit).toHaveBeenCalledWith(OZON_PROMO_SWEEP_EVENT, { selected: 1 });
    });
});
