import { LogShortageNotifyCommand } from './log-shortage-notify.command';
import { IFboCreateContext } from './i.fbo-create.context';
import { GoodServiceEnum } from '../../good/good.service.enum';

describe('LogShortageNotifyCommand', () => {
    const logShortage = jest.fn();
    const emit = jest.fn();
    const command = new LogShortageNotifyCommand({ logShortage } as any, { emit } as any);

    const ctx = (over: Partial<IFboCreateContext>): IFboCreateContext =>
        ({
            service: GoodServiceEnum.WB,
            posting: { posting_number: '321', products: [] } as any,
            prims: ['WBFBO'],
            primLabel: 'WBFBO',
            buyerId: 1,
            useMigration: false,
            setIgkNot1c: false,
            pickupAfterCreate: true,
            skipIfNoPodbor: true,
            transaction: null,
            ...over,
        });

    beforeEach(() => {
        logShortage.mockReset();
        emit.mockReset();
    });

    it('нет недостач → проходит дальше, без журнала и письма', async () => {
        const res = await command.execute(ctx({ shortages: [] }));
        expect(logShortage).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
        expect(res.stopChain).toBeUndefined();
    });

    it('есть недобор → журнал по каждой позиции + одно письмо, счёт НЕ трогаем', async () => {
        const res = await command.execute(
            ctx({ invoice: { id: 999 } as any, shortages: [{ goodscode: '444', quantity: 1 }, { goodscode: '555', quantity: 2 }] }),
        );

        expect(logShortage).toHaveBeenCalledTimes(2);
        expect(logShortage).toHaveBeenCalledWith(GoodServiceEnum.WB, '321', '444', 1, 'WBFBO', null);
        expect(logShortage).toHaveBeenCalledWith(GoodServiceEnum.WB, '321', '555', 2, 'WBFBO', null);

        expect(emit).toHaveBeenCalledTimes(1);
        const [evt, subject, body] = emit.mock.calls[0];
        expect(evt).toBe('error.message');
        expect(subject).toContain('спишите вручную');
        expect(body).toContain('Заказ: 321');
        expect(body).toContain('444 × 1');
        expect(body).toContain('555 × 2');

        // счёт остаётся, цепочка не останавливается
        expect(res.stopChain).toBeUndefined();
        expect(res.invoice).toEqual({ id: 999 });
    });

    it('с flushers → письмо откладывается на after-commit, сразу не шлётся', async () => {
        const flushers: (() => Promise<void>)[] = [];
        await command.execute(ctx({ flushers, shortages: [{ goodscode: '444', quantity: 1 }] }));

        // журнал пишется сразу (внутри транзакции), письмо — нет
        expect(logShortage).toHaveBeenCalledTimes(1);
        expect(emit).not.toHaveBeenCalled();
        expect(flushers).toHaveLength(1);

        // после commit прогоняем flusher → письмо уходит
        await flushers[0]();
        expect(emit).toHaveBeenCalledTimes(1);
    });
});
