import { LoadSnapshotCommand } from './load-snapshot.command';
import { IGoodsCountContext } from './i.goods.count.context';
import { GoodServiceEnum } from '../../../good/good.service.enum';

describe('LoadSnapshotCommand', () => {
    const transaction = { commit: jest.fn(), rollback: jest.fn() };

    const goodServiceMock = (over: any = {}) => ({
        getTransaction: jest.fn().mockResolvedValue(transaction),
        in: jest.fn().mockResolvedValue([{ code: '498824', quantity: 100, reserve: 0, name: 'x' }]),
        getDisabledCodes: jest.fn().mockResolvedValue([]),
        getMarkRequiredCodes: jest.fn().mockResolvedValue(new Set()),
        getGoodsWithMarkCodes: jest.fn().mockResolvedValue(new Set()),
        getFreeMarkCodesByNominal: jest.fn().mockResolvedValue(new Map()),
        getReservedQuantities: jest.fn().mockResolvedValue(new Map()),
        ...over,
    });

    const context = (over: Partial<IGoodsCountContext> = {}): IGoodsCountContext =>
        ({
            serviceKey: GoodServiceEnum.OZON,
            service: { skuList: [] } as any,
            goods: [],
            disabled: new Set<string>(),
            markedGoods: new Set<string>(),
            freeByGood: new Map(),
            filteredSkuMap: new Map(),
            counts: new Map(),
            updated: 0,
            ...over,
        }) as IGoodsCountContext;

    beforeEach(() => jest.clearAllMocks());

    it('крон-путь: грузит товары по goodIds в той же транзакции и коммитит её', async () => {
        const good = goodServiceMock();
        const result = await new LoadSnapshotCommand(good as any).execute(context({ goodIds: ['498824'] }));

        expect(good.in).toHaveBeenCalledWith(['498824'], transaction);
        expect(good.getDisabledCodes).toHaveBeenCalledWith(GoodServiceEnum.OZON, transaction);
        expect(transaction.commit).toHaveBeenCalledWith(true);
        expect(result.goods).toEqual([{ code: '498824', quantity: 100, reserve: 0, name: 'x' }]);
        // транзакция закрыта — дальше идут расчёт и поход в маркет
        expect(result.transaction).toBeNull();
    });

    it('событийный путь: товары уже переданы, in() не зовётся', async () => {
        const good = goodServiceMock();
        const goods = [{ code: '111', quantity: 5, reserve: 0, name: 'y' }] as any;

        const result = await new LoadSnapshotCommand(good as any).execute(context({ goods }));

        expect(good.in).not.toHaveBeenCalled();
        expect(result.goods).toBe(goods);
    });

    it('по маркировке считается только товар с MARK_REQUIRED=1 И строками в MARKCODES', async () => {
        const good = goodServiceMock({
            in: jest.fn().mockResolvedValue([
                { code: '498824', quantity: 100, reserve: 0, name: 'a' },
                { code: '548580', quantity: 100, reserve: 0, name: 'b' },
                { code: '111', quantity: 100, reserve: 0, name: 'c' },
            ]),
            getMarkRequiredCodes: jest.fn().mockResolvedValue(new Set(['498824', '548580'])),
            getGoodsWithMarkCodes: jest.fn().mockResolvedValue(new Set(['498824'])),
            getFreeMarkCodesByNominal: jest.fn().mockResolvedValue(new Map([['498824', new Map([[100, 1]])]])),
            getReservedQuantities: jest.fn().mockResolvedValue(new Map([['498824', [1, 3, 3]]])),
        });

        const result = await new LoadSnapshotCommand(good as any).execute(context({ goodIds: ['498824', '548580', '111'] }));

        // на проверку кодов уходят только маркируемые, немаркируемый 111 не спрашиваем
        expect(good.getGoodsWithMarkCodes).toHaveBeenCalledWith(['498824', '548580'], transaction);
        // 548580 маркируемый, но кодов не заводилось → старая схема
        expect(result.markedGoods).toEqual(new Set(['498824']));
        expect(result.freeByGood).toEqual(new Map([['498824', new Map([[100, 1]])]]));
        // резерв тянем построчно, заказами
        expect(good.getReservedQuantities).toHaveBeenCalledWith(['498824'], transaction);
        expect(result.reservedByGood).toEqual(new Map([['498824', [1, 3, 3]]]));
    });

    it('маркируемых нет — свободные коды не запрашиваем', async () => {
        const good = goodServiceMock();

        await new LoadSnapshotCommand(good as any).execute(context({ goodIds: ['111'] }));

        expect(good.getGoodsWithMarkCodes).not.toHaveBeenCalled();
        expect(good.getFreeMarkCodesByNominal).not.toHaveBeenCalled();
    });

    it('ошибка чтения — транзакция откатывается', async () => {
        const good = goodServiceMock({ getDisabledCodes: jest.fn().mockRejectedValue(new Error('boom')) });

        await expect(new LoadSnapshotCommand(good as any).execute(context({ goodIds: ['1'] }))).rejects.toThrow('boom');
        expect(transaction.rollback).toHaveBeenCalledWith(true);
        expect(transaction.commit).not.toHaveBeenCalled();
    });
});
