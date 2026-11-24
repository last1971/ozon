import { NotifySweepCommand, OZON_PROMO_SWEEP_EVENT } from './notify-sweep.command';

describe('Уведомление после проверки Ozon', () => {
    const emit = jest.fn();
    const cmd = new NotifySweepCommand({ emit } as any);
    beforeEach(() => emit.mockReset());
    it('сообщает только о подтверждённых изменениях', async () => {
        const report = {items: [{verification: 'confirmed'}, {verification: 'pending'}]};
        await cmd.execute({ apply: true, report } as any);
        expect(emit).toHaveBeenCalledWith(OZON_PROMO_SWEEP_EVENT, report);
    });
    it('при повторном приёме тех же запросов без подтверждения и в режиме просмотра молчит', async () => {
        const report = {items: [{verification: 'pending'}, {verification: 'unchanged'}, {applied: true}]};
        await cmd.execute({ apply: true, report } as any);
        await cmd.execute({ apply: true, report } as any);
        await cmd.execute({ apply: false, report: {items: [{verification: 'confirmed'}]} } as any);
        expect(emit).not.toHaveBeenCalled();
    });
});

it('подтверждение после перезапуска попадает в отчёт и бот, даже если новая сверка не отобрала ни одного товара', async () => {
    const step = { kind: 'percent', actionId: 3, sku: 4, from: 5, to: 22 };
    const result = {
        offerId: '563967-4', productId: 11, ok: true, applied: true, verification: 'confirmed',
        buyerBefore: 674, buyerAfter: 259, target: 258, steps: [step], notes: [],
        state: { price: 710, minPrice: 258 }, results: [{ step, status: 'ok', changed: true }],
    };
    let token = 'before', notice: any = { result };
    const journal = {
        outstanding: async () => notice ? new Map([['first-step', { token, payload: notice }]]) : new Map(),
        advance: async (_id, version, next) => {
            if (token !== version) return null;
            token += '-1';
            notice = next;
            return { token, payload: notice };
        },
        finish: async (_id, version) => {
            if (version !== token) return false;
            notice = null;
            return true;
        },
    };
    const emitAsync = jest.fn().mockResolvedValueOnce([false]).mockResolvedValue([true]);
    const run = () => new NotifySweepCommand({ emitAsync } as any, journal as any).execute({
        apply: true, goal: 'min', checked: 1, progress: { done: 0, counters: {} }, plans: [], results: [],
    });
    const first = await run();
    expect(first.report.items[0]).toMatchObject({ offerId: '563967-4', verification: 'confirmed' });
    expect(first.report.percentChanged).toBe(1);
    await run();
    await run();
    expect(emitAsync).toHaveBeenCalledTimes(2);
    expect(emitAsync.mock.calls[0][2]).toBe(emitAsync.mock.calls[1][2]);
    expect(notice).toBeNull();
});
