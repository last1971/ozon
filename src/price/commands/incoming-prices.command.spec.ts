import { IncomingPricesCommand } from './incoming-prices.command';
import { ExtraGoodService } from '../../good/extra.good.service';
import { GoodServiceEnum } from '../../good/good.service.enum';
function setup() {
    const list = ['123', '123-2', '1234'];
    const goods = {
        listServices: () => [
            { service: GoodServiceEnum.OZON, isSwitchedOn: true },
            { service: GoodServiceEnum.WB, isSwitchedOn: true },
        ],
        isSkuListAvailable: () => true,
        whenSkuListsReady: jest.fn(async () => {}),
        getCountUpdateableService: () => ({ skuList: list }),
        tradeSkusToServiceSkus: jest.fn(() => list),
    };
    const prices = {
        getService: jest.fn((name) => ([GoodServiceEnum.OZON, GoodServiceEnum.WB].includes(name) ? {} : null)),
        updatePriceForGoodSkus: jest.fn(async () => []),
    };
    const workflow = { incoming: jest.fn(async (_service, offers) => offers.map((offerId) => ({ offerId }))) };
    const command = new IncomingPricesCommand(prices as any, goods as any, workflow as any);
    return { command, prices, goods, workflow };
}
it('только свои фасовки, Ozon и WB идут независимо; наценки не меняются', async () => {
    const s = setup();
    const guard = jest.fn(async () => {});
    const result = await s.command.execute({ skus: ['123'], assertInputsCurrent: guard });
    expect(s.workflow.incoming).toHaveBeenCalledWith('OZON', ['123', '123-2'], guard);
    expect(s.workflow.incoming).toHaveBeenCalledWith('WB', ['123', '123-2'], guard);
    expect(result.incomingFailures).toEqual([]);
    expect(s.prices.updatePriceForGoodSkus).not.toHaveBeenCalled();
});
it('ошибка Ozon не отменяет проверку WB и остаётся в результате прихода', async () => {
    const s = setup();
    s.workflow.incoming.mockRejectedValueOnce(Error('Ошибка акций'));
    const result = await s.command.execute({ skus: ['123'] });
    expect(result.incomingFailures).toEqual([{ service: 'ozon', offerId: '123', error: 'Ошибка акций' }]);
    expect(s.workflow.incoming).toHaveBeenCalledWith('WB', expect.any(Array), undefined);
});
it('незагруженный список артикулов не выдаётся за отсутствие товаров', async () => {
    const s = setup();
    s.goods.isSkuListAvailable = () => false;
    const result = await s.command.execute({ skus: ['123'] });
    expect(result.incomingFailures).toHaveLength(2);
    expect(result.incomingFailures[0].error).toContain('недоступен');
    expect(s.workflow.incoming).not.toHaveBeenCalled();
});
it('точное сопоставление Trade не захватывает соседний числовой код', () => {
    const service = Object.create(ExtraGoodService.prototype) as ExtraGoodService;
    (service as any).getCountUpdateableService = () => ({ skuList: ['123', '123-2', '1234', '1234-5', '12'] });
    expect(service.tradeSkusToServiceSkus(['123'], GoodServiceEnum.OZON)).toEqual(['123', '123-2']);
});

it('ошибка загрузки списка отличается от отключённого обновления остатков с доступным списком', async () => {
    const service = Object.create(ExtraGoodService.prototype) as ExtraGoodService;
    const entry = { service: { skuList: ['123'] }, isSwitchedOn: false, skuListLoadFailed: false };
    (service as any).services = new Map([[GoodServiceEnum.WB, entry]]);
    expect(service.isSkuListAvailable(GoodServiceEnum.WB)).toBe(true);
    entry.skuListLoadFailed = true;
    expect(service.isSkuListAvailable(GoodServiceEnum.WB)).toBe(false);
});
