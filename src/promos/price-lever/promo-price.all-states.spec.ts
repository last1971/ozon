import { PromoPriceService } from './promo-price.service';
import { ProductVisibility } from '../../product/product.visibility';
const item = (offer_id: string) => ({
    offer_id,
    product_id: Number(offer_id),
    price: { price: 500, min_price: 150, old_price: 600, marketing_seller_price: 500 },
});
const make = () => {
    const api = { listActions: jest.fn().mockResolvedValue([]), listAll: jest.fn() };
    const seller = { activeAction: jest.fn().mockResolvedValue(null), listAll: jest.fn() };
    const products = {
        listAllOfferIds: jest.fn().mockResolvedValue(['1', '2']),
        getPrices: jest.fn().mockImplementation(async ({ offer_id }) => ({ items: offer_id.map(item) })),
    };
    const service = new PromoPriceService(api as any, seller as any, products as any, { apply: jest.fn() } as any);
    return { service, api, seller, products };
};
describe('Состояния всего кабинета Ozon', () => {
    it('возвращает товары вне акций и кандидатов; снимок акций один на каталог', async () => {
        const m = make();
        m.api.listActions.mockResolvedValue([{ id: 7, title: 'test' }]);
        m.api.listAll.mockImplementation(async (kind) =>
            kind === 'products' ? [{ id: 1, actionPrice: 300, maxActionPrice: 400 }] : [{ id: 2, maxActionPrice: 400 }],
        );
        m.products.listAllOfferIds.mockResolvedValue(['1', '2', '3']);
        const result = await m.service.allStates();
        expect(result.map((s) => s.offerId)).toEqual(['1', '2', '3']);
        expect(result[0].ozonActions[0].participant).toBe(true);
        expect(result[1].ozonActions[0].participant).toBe(false);
        expect(result[2]).toMatchObject({ seller: null, ozonActions: [] });
        expect(m.api.listActions).toHaveBeenCalledTimes(1);
        expect(m.seller.activeAction).toHaveBeenCalledTimes(1);
    });
    it('1001 товар загружается пачками 1000 и 1, повтор offer_id исключается', async () => {
        const m = make();
        const ids = Array.from({ length: 1001 }, (_, i) => String(i + 1));
        m.products.listAllOfferIds.mockResolvedValue([...ids, '1']);
        expect(await m.service.allStates()).toHaveLength(1001);
        expect(m.products.getPrices).toHaveBeenCalledTimes(2);
        expect(m.products.getPrices).toHaveBeenNthCalledWith(1, {
            offer_id: ids.slice(0, 1000),
            limit: 1000,
            visibility: ProductVisibility.ALL,
        });
        expect(m.products.getPrices).toHaveBeenNthCalledWith(2, {
            offer_id: ['1001'],
            limit: 1,
            visibility: ProductVisibility.ALL,
        });
    });
    it.each([
        undefined,
        { items: [] },
        { items: [item('1')] },
        { items: [item('1'), item('1')] },
        { items: [item('1'), item('99')] },
    ])('не выдаёт неполную выборку за весь каталог: %j', async (response) => {
        const m = make();
        m.products.getPrices.mockResolvedValue(response);
        await expect(m.service.allStates()).rejects.toThrow('Неполный ответ');
    });
    it('пустой каталог не запрашивает цены и акции', async () => {
        const m = make();
        m.products.listAllOfferIds.mockResolvedValue([]);
        expect(await m.service.allStates()).toEqual([]);
        expect(m.products.getPrices).not.toHaveBeenCalled();
        expect(m.api.listActions).not.toHaveBeenCalled();
    });
});
