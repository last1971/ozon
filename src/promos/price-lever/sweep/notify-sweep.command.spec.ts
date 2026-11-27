import { NotifySweepCommand, OZON_PROMO_SWEEP_EVENT } from './notify-sweep.command';

describe('Уведомление после проверки Ozon', () => {
    const emit = jest.fn();
    const cmd = new NotifySweepCommand({ emitAsync: emit } as any);
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

