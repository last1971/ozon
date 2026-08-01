import { PickupFboCommand } from './pickup-fbo.command';
import { IFboCreateContext } from './i.fbo-create.context';
import { GoodServiceEnum } from '../../good/good.service.enum';

describe('PickupFboCommand', () => {
    const pickupFboUnlessShortage = jest.fn();
    const command = new PickupFboCommand({ pickupFboUnlessShortage } as any);

    const ctx = (over: Partial<IFboCreateContext>): IFboCreateContext =>
        ({
            service: GoodServiceEnum.WB,
            posting: { posting_number: 'srid-1', products: [] } as any,
            prims: ['WBFBO'],
            primLabel: 'WBFBO',
            buyerId: 1,
            useMigration: false,
            setIgkNot1c: false,
            pickupAfterCreate: true,
            skipIfNoPodbor: true,
            transaction: null,
            invoice: { id: 999 } as any,
            ...over,
        });

    beforeEach(() => pickupFboUnlessShortage.mockReset());

    it('pickupAfterCreate + счёт есть → подбор через хелпер (недобор он сам отсеет)', async () => {
        await command.execute(ctx({}));
        expect(pickupFboUnlessShortage).toHaveBeenCalledWith({ id: 999 }, null);
    });

    it('pickupAfterCreate=false (Ozon) → не подбираем здесь', async () => {
        await command.execute(ctx({ pickupAfterCreate: false }));
        expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
    });

    it('счёт не создан (null) → не подбираем', async () => {
        await command.execute(ctx({ invoice: null }));
        expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
    });
});
