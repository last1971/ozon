import { Test } from '@nestjs/testing';
import { PriceService } from '../price/price.service';
import { ProductService } from '../product/product.service';
import { LegacyPromoActionWriter } from './legacy-promo-action-writer';
import { OzonPromosApi } from './promos.api';
import { FitProductsStrategy, PromosService } from './promos.service';
import { OzonSellerActionsApi } from './seller-actions.api';

describe('PromosService', () => {
    const listActions = jest.fn(),
        listAll = jest.fn(),
        index = jest.fn(),
        counts = jest.fn(),
        prices = jest.fn();
    const activeSeller = jest.fn(),
        sellerList = jest.fn(),
        apply = jest.fn();
    let service: PromosService;
    beforeEach(async () => {
        jest.resetAllMocks();
        listActions.mockResolvedValue([{ id: 1 }]);
        activeSeller.mockResolvedValue(null);
        apply.mockImplementation(async (_, intents) => ({
            added: intents.filter((i) => i.mode === 'add').map((i) => i.productId),
            removed: intents.filter((i) => i.mode !== 'add').map((i) => i.productId),
            failed: [],
        }));
        const module = await Test.createTestingModule({
            providers: [
                PromosService,
                { provide: OzonPromosApi, useValue: { listActions, listAll } },
                { provide: OzonSellerActionsApi, useValue: { activeAction: activeSeller, listAll: sellerList } },
                { provide: PriceService, useValue: { index } },
                { provide: ProductService, useValue: { getProductsPrices: prices, getFreeProductCount: counts } },
                { provide: LegacyPromoActionWriter, useValue: { apply } },
            ],
        }).compile();
        service = module.get(PromosService);
    });
    const product = (id: number, actionPrice: number, maxActionPrice = 1000) => ({
        id,
        actionPrice,
        maxActionPrice,
        stock: id,
    });
    const price = (id: number, min_price: number) => ({ id, price: { min_price } });
    const stock = (id: number, count: number) => ({ id, count });
    const percent = (entries: [number, number][]) => {
        activeSeller.mockResolvedValue({ id: 42, minPercent: 5 });
        sellerList.mockResolvedValue(entries.map(([productId, percent]) => ({ productId, percent, isActive: true })));
    };

    it('заниженную цену поднимает до пола с процентом, нулевой остаток снимает и не принимает неизвестный остаток за ноль', async () => {
        listAll.mockResolvedValue([product(1, 90), product(2, 105), product(3, 103), product(4, 105)]);
        prices.mockResolvedValue([1, 2, 3, 4].map((id) => price(id, 100)));
        counts.mockResolvedValue([stock(1, 1), stock(2, 0), stock(3, 2)]);
        percent([[1, 5]]);
        expect(await service.unfitProductsRemoval(1)).toBe(2);
        expect(apply).toHaveBeenCalledWith(
            1,
            [
                { mode: 'repair', productId: 1, actionPrice: 106, stock: 1 },
                { mode: 'remove', productId: 2, actionPrice: 100, stock: 2 },
            ],
            expect.any(Function),
        );
        expect(sellerList).toHaveBeenCalledWith('list', 42);
    });
    it('неизвестная акция и ошибка транспорта доступны вызывающей стороне', async () => {
        await expect(service.unfitProductsRemoval(847)).rejects.toThrow('847');
        listAll.mockRejectedValue(new Error('API Error'));
        await expect(service.unfitProductsRemoval(1)).rejects.toThrow('API Error');
    });
    it.each([
        [FitProductsStrategy.MAX_ACTION_PRICE, [50, 100]],
        [FitProductsStrategy.MAX_FROM_ACTION_PRICE_AND_MIN_PRICE, [45, 90]],
        [FitProductsStrategy.MIN_FROM_MIN_PRICE, [40, 90]],
    ])('отбирает кандидатов по остатку и лимиту, сохраняет цены стратегии %s', async (strategy, expected) => {
        listAll.mockResolvedValue([product(1, 45, 50), product(2, 85, 100), product(3, 100, 150), product(4, 85, 100)]);
        prices.mockResolvedValue([price(1, 40), price(2, 90), price(3, 160), price(4, 90)]);
        counts.mockResolvedValue([stock(1, 1), stock(2, 1), stock(3, 1), stock(4, 0)]);
        expect(await service.fitProductsAddition(1, strategy as FitProductsStrategy)).toBe(2);
        expect(apply.mock.calls[0][1]).toEqual(
            (expected as number[]).map((value, i) => ({
                productId: i + 1,
                mode: 'add',
                actionPrice: value,
                stock: i + 1,
            })),
        );
    });
    it('не считает неподтверждённый ответ успешным для ручки с числовым результатом', async () => {
        listAll.mockResolvedValue([product(2, 85, 100)]);
        prices.mockResolvedValue([price(2, 90)]);
        counts.mockResolvedValue([stock(2, 1)]);
        apply.mockResolvedValue({ added: [], removed: [], failed: [{ productId: 2, reason: 'Ожидаем Ozon' }] });
        await expect(service.fitProductsAddition(1, FitProductsStrategy.MIN_FROM_MIN_PRICE)).rejects.toThrow(
            '2: Ожидаем Ozon',
        );
    });
    it('по событию берёт минимум с процентом и возвращает отдельно подтверждённые изменения и отказы', async () => {
        index.mockResolvedValue({
            data: [
                { offer_id: '1', product_id: 1, min_price: 100, fboCount: 2, fbsCount: 1 },
                { offer_id: '2', product_id: 2, min_price: 200, fboCount: 2, fbsCount: 1 },
                { offer_id: '3', product_id: 3, min_price: 300, fboCount: 0, fbsCount: 4 },
                { offer_id: '4', product_id: 4, min_price: 0, fboCount: 0, fbsCount: 1 },
            ],
        });
        percent([
            [1, 5],
            [3, 5],
        ]);
        listAll
            .mockResolvedValueOnce([product(1, 99)])
            .mockResolvedValueOnce([product(2, 0, 220), product(3, 0, 315), product(4, 0, 15)]);
        apply.mockResolvedValue({
            added: [],
            removed: [1],
            failed: [{ productId: 2, reason: 'ожидает подтверждения' }],
        });
        const result = await service.addRemoveProductToActions(['1', '2', '3', '4']);
        expect(apply.mock.calls[0][1]).toEqual([
            { mode: 'repair', productId: 1, actionPrice: 106, stock: 1 },
            { mode: 'add', productId: 2, actionPrice: 220, stock: 3 },
        ]);
        expect(result).toEqual([
            {
                action_id: 1,
                removed: { success_ids: [1], failed: [] },
                added: { success_ids: [], failed: [{ productId: 2, reason: 'ожидает подтверждения' }] },
            },
        ]);
    });
    it('цены запрашиваются страницами и массовое событие покрывает запрошенные SKU', async () => {
        listActions.mockResolvedValue([]);
        index.mockResolvedValue({ data: [] });
        await service.addRemoveProductToActions(['a', 'b', 'c'], 2);
        expect(index.mock.calls.map(([q]) => q.offer_id)).toEqual([['a', 'b'], ['c']]);
        const call = jest.spyOn(service, 'addRemoveProductToActions').mockResolvedValue([]);
        await service.handleUpdatePromos(['a']);
        expect(call).toHaveBeenCalledWith(['a']);
    });
});
