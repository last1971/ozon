import { Test } from '@nestjs/testing';
import { ProductService } from '../../product/product.service';
import { OzonPromosApi } from '../promos.api';
import { OzonSellerActionsApi } from '../seller-actions.api';
import { PromoPriceApplier } from './promo-price.applier';
import { PromoPriceService } from './promo-price.service';

describe('PromoPriceService — состояние товара из обоих контуров акций', () => {
    let service: PromoPriceService;
    const listActions = jest.fn();
    const listAll = jest.fn();
    const activeAction = jest.fn();
    const sellerListAll = jest.fn();
    const getPrices = jest.fn();
    const applierApply = jest.fn();

    /** 383367 из v5 живьём 19.10. */
    const v5item = {
        offer_id: '383367',
        product_id: 2065673718,
        price: { price: 255, min_price: 213, old_price: 321, marketing_seller_price: 215 },
        marketing_actions: {
            actions: [
                { title: 'Эластичный бустинг. Без ограничения срока действия', value: 226, date_from: '', date_to: '' },
                { title: 'РК. Рассрочка 0-0-4', value: 4, date_from: '', date_to: '' },
                { title: '26-10', value: 5, date_from: '', date_to: '' },
            ],
        },
    };
    const ozonProduct = (id: number, over: any = {}) => ({
        id,
        price: 255,
        actionPrice: 226,
        maxActionPrice: 245,
        stock: 0,
        minStock: 0,
        ...over,
    });
    const sellerProduct = (productId: number, over: any = {}) => ({
        productId,
        sku: 2360940454,
        offerId: '383367',
        percent: 5,
        isActive: true,
        ...over,
    });

    beforeEach(async () => {
        [listActions, listAll, activeAction, sellerListAll, getPrices, applierApply].forEach((m) => m.mockReset());
        const module = await Test.createTestingModule({
            providers: [
                PromoPriceService,
                { provide: OzonPromosApi, useValue: { listActions, listAll } },
                { provide: OzonSellerActionsApi, useValue: { activeAction, listAll: sellerListAll } },
                { provide: ProductService, useValue: { getPrices } },
                { provide: PromoPriceApplier, useValue: { apply: applierApply } },
            ],
        }).compile();
        service = module.get(PromoPriceService);
    });

    it('собирает 383367: Ozon-акция участник, вторая — кандидат, наш процент; формула сходится с Ozon', async () => {
        getPrices.mockResolvedValue({ items: [v5item], cursor: '' });
        listActions.mockResolvedValue([
            { id: 1977747, title: 'Эластичный бустинг', is_voucher_action: false },
            { id: 4400847, title: 'Максимальный бустинг 11.11', is_voucher_action: false },
        ]);
        listAll
            .mockResolvedValueOnce([ozonProduct(2065673718), ozonProduct(1)]) // участники 1977747
            .mockResolvedValueOnce([ozonProduct(2065673718, { actionPrice: 0 })]) // он же в кандидатах — не дублируем
            .mockResolvedValueOnce([]) // участники 4400847
            .mockResolvedValueOnce([ozonProduct(2065673718, { actionPrice: 0, maxActionPrice: 200 })]);
        activeAction.mockResolvedValue({ id: 4376619, title: '26-10', minPercent: 5 });
        sellerListAll
            .mockResolvedValueOnce([sellerProduct(2065673718)]) // list
            .mockResolvedValueOnce([sellerProduct(2065673718, { isActive: false, percent: 7 })]); // candidates

        const [s] = await service.states(['383367', ' 383367 ']);

        expect(getPrices).toHaveBeenCalledWith({ offer_id: ['383367'], visibility: 'ALL', limit: 1 });
        expect(s).toEqual({
            offerId: '383367',
            productId: 2065673718,
            oldPrice: 321,
            price: 255,
            minPrice: 213,
            buyerPrice: 215,
            buyerPriceCalc: 215,
            seller: { actionId: 4376619, title: '26-10', minPercent: 5, sku: 2360940454, percent: 5, isActive: true },
            ozonActions: [
                {
                    actionId: 1977747,
                    title: 'Эластичный бустинг',
                    isVoucher: false,
                    participant: true,
                    actionPrice: 226,
                    maxActionPrice: 245,
                    stock: 0,
                },
                {
                    actionId: 4400847,
                    title: 'Максимальный бустинг 11.11',
                    isVoucher: false,
                    participant: false,
                    actionPrice: 0,
                    maxActionPrice: 200,
                    stock: 0,
                },
            ],
        });
    });

    it('нашей акции нет — seller null, sellerApi.listAll не зовём', async () => {
        getPrices.mockResolvedValue({ items: [v5item], cursor: '' });
        listActions.mockResolvedValue([]);
        activeAction.mockResolvedValue(null);
        const [s] = await service.states(['383367']);
        expect(s.seller).toBeNull();
        expect(sellerListAll).not.toHaveBeenCalled();
    });

    it('plans — состояние через планировщик', async () => {
        getPrices.mockResolvedValue({ items: [v5item], cursor: '' });
        listActions.mockResolvedValue([{ id: 1977747, title: 'Эластичный бустинг', is_voucher_action: false }]);
        listAll.mockResolvedValueOnce([ozonProduct(2065673718)]).mockResolvedValueOnce([]);
        activeAction.mockResolvedValue({ id: 4376619, title: '26-10', minPercent: 5 });
        sellerListAll.mockResolvedValueOnce([sellerProduct(2065673718)]).mockResolvedValueOnce([]);
        const [plan] = await service.plans(['383367'], 'normal');
        expect(plan.buyerAfter).toBe(233);
        expect(plan.steps).toHaveLength(1);
    });

    it('apply — план из свежего состояния уходит исполнителю, по товару', async () => {
        getPrices.mockResolvedValue({ items: [v5item], cursor: '' });
        listActions.mockResolvedValue([]);
        activeAction.mockResolvedValue(null);
        applierApply.mockImplementation(async (p: any) => ({ ...p, results: [], applied: true }));
        const [res] = await service.apply(['383367'], 'min');
        expect(getPrices).toHaveBeenCalledTimes(1);
        expect(applierApply).toHaveBeenCalledWith(expect.objectContaining({ offerId: '383367', target: 213 }));
        expect(res.applied).toBe(true);
    });

    it('пустой список и больше 100 артикулов — 400', async () => {
        await expect(service.states([' '])).rejects.toThrow('нет артикулов');
        await expect(service.states(Array.from({ length: 101 }, (_, i) => String(i)))).rejects.toThrow('100');
    });

    it('parseTarget', () => {
        expect(PromoPriceService.parseTarget('min')).toBe('min');
        expect(PromoPriceService.parseTarget('240')).toBe(240);
        expect(() => PromoPriceService.parseTarget('0')).toThrow();
    });
});
