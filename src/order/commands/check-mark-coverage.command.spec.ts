import { CheckMarkCoverageCommand } from './check-mark-coverage.command';
import { IPickupContext } from './i.pickup.context';

describe('CheckMarkCoverageCommand', () => {
    const invoice = (status: number) => ({ id: 300739, number: 77876, remark: '5771104739', status }) as any;

    const make = (uncovered: any[] | Error) => {
        const getUncoveredMarkLines = jest.fn(async () => {
            if (uncovered instanceof Error) throw uncovered;
            return uncovered;
        });
        const emit = jest.fn();
        const command = new CheckMarkCoverageCommand({ getUncoveredMarkLines } as any, { emit } as any);
        jest.spyOn(command['logger'], 'warn').mockImplementation(() => undefined);
        return { command, getUncoveredMarkLines, emit };
    };

    const ctx = (status = 3): IPickupContext => ({ invoice: invoice(status), transaction: null });

    it('строка без КМ — письмо с номером счёта и раскладкой', async () => {
        const { command, emit } = make([{ realpricecode: 605276, goodscode: '549853', needed: 1, attached: 0 }]);

        const result = await command.execute(ctx());

        expect(result.uncovered).toHaveLength(1);
        expect(emit).toHaveBeenCalledWith(
            'error.message',
            'Подбор закрыт без кодов маркировки',
            expect.stringContaining('товар 549853: нужно 1, привязано 0'),
        );
    });

    it('всё покрыто — молчим', async () => {
        const { command, emit } = make([]);

        await command.execute(ctx());

        expect(emit).not.toHaveBeenCalled();
    });

    it('подобранный счёт не проверяем — иначе письмо на каждом прогоне', async () => {
        const { command, getUncoveredMarkLines, emit } = make([{ goodscode: '1', needed: 1, attached: 0 } as any]);

        await command.execute(ctx(4));

        expect(getUncoveredMarkLines).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('сбой проверки не роняет подбор — счёт важнее письма', async () => {
        const { command, emit } = make(new Error('DB down'));

        const result = await command.execute(ctx());

        expect(result.stopChain).toBeFalsy();
        expect(emit).not.toHaveBeenCalled();
    });
});
