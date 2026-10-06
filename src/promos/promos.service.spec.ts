import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from '../price/price.service';
import { ProductService } from '../product/product.service';
import { OzonPromosApi } from './promos.api';
import { FitProductsStrategy, PromosService } from './promos.service';
import { ActionProduct } from './promos.types';

describe('PromosService — правила участия в акциях', () => {
    let service: PromosService;
    const listActions = jest.fn();
    const listAll = jest.fn();
    const update = jest.fn();
    const deactivate = jest.fn();
    const index = jest.fn();
    const getFreeProductCount = jest.fn();
    const getProductsPrices = jest.fn();

    const product = (id: number, over: Partial<ActionProduct> = {}): ActionProduct => ({
        id,
        price: 0,
        actionPrice: 0,
        maxActionPrice: 0,
        stock: 0,
        minStock: 0,
        ...over,
    });
    const okUpdate = (over: any = {}) => ({ added: [], removed: [], rejected: [], warnings: [], ...over });
    const boosting = { id: 1, is_voucher_action: false } as any;
    const voucher = { id: 2, is_voucher_action: true } as any;

    beforeEach(async () => {
        [listActions, listAll, update, deactivate, index, getFreeProductCount, getProductsPrices].forEach((m) =>
            m.mockReset(),
        );
        update.mockResolvedValue(okUpdate());
        deactivate.mockResolvedValue([]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PromosService,
                { provide: OzonPromosApi, useValue: { listActions, listAll, update, deactivate } },
                { provide: PriceService, useValue: { index } },
                { provide: ProductService, useValue: { getFreeProductCount, getProductsPrices } },
            ],
        }).compile();
        service = module.get(PromosService);
    });

    describe('unfitProductsRemoval', () => {
        const inAction = [
            product(1, { actionPrice: 50, stock: 3 }), // цена акции ниже минимальной → снять
            product(2, { actionPrice: 100 }), // в норме
            product(3, { actionPrice: 150 }), // ниже минимальной → снять
            product(4, { actionPrice: 100 }), // нет остатка → снять
        ];
        const prices = [
            { id: 1, price: { min_price: 60 } },
            { id: 2, price: { min_price: 90 } },
            { id: 3, price: { min_price: 170 } },
            { id: 4, price: { min_price: 90 } },
        ] as any;
        const counts = [1, 1, 1, 0].map((count, i) => ({ id: i + 1, count }));

        it('бустинг/сток: снятие через update нашей минимальной ценой', async () => {
            listActions.mockResolvedValue([boosting]);
            listAll.mockResolvedValue(inAction);
            getProductsPrices.mockResolvedValue(prices);
            getFreeProductCount.mockResolvedValue(counts);
            update.mockResolvedValue(okUpdate({ removed: [1, 3, 4] }));

            expect(await service.unfitProductsRemoval(1)).toBe(3);
            expect(listAll).toHaveBeenCalledWith('products', 1);
            expect(update).toHaveBeenCalledWith(1, [
                { productId: 1, actionPrice: 60, stock: 3 },
                { productId: 3, actionPrice: 170, stock: 0 },
                { productId: 4, actionPrice: 90, stock: 0 },
            ]);
            expect(deactivate).not.toHaveBeenCalled();
        });

        it('промокоды: снятие принудительно через deactivate', async () => {
            listActions.mockResolvedValue([voucher]);
            listAll.mockResolvedValue(inAction);
            getProductsPrices.mockResolvedValue(prices);
            getFreeProductCount.mockResolvedValue(counts);
            deactivate.mockResolvedValue([1, 3, 4]);

            expect(await service.unfitProductsRemoval(2)).toBe(3);
            expect(deactivate).toHaveBeenCalledWith(2, [1, 3, 4]);
            expect(update).not.toHaveBeenCalled();
        });

        it('снимать нечего → в API не ходим', async () => {
            listActions.mockResolvedValue([boosting]);
            listAll.mockResolvedValue([product(2, { actionPrice: 100 })]);
            getProductsPrices.mockResolvedValue([{ id: 2, price: { min_price: 90 } }]);
            getFreeProductCount.mockResolvedValue([{ id: 2, count: 1 }]);

            expect(await service.unfitProductsRemoval(1)).toBe(0);
            expect(update).not.toHaveBeenCalled();
        });

        it('неизвестная акция → ошибка, а не тихий ноль', async () => {
            listActions.mockResolvedValue([boosting]);
            await expect(service.unfitProductsRemoval(777)).rejects.toThrow('777');
        });

        it('ошибка API пробрасывается', async () => {
            listActions.mockResolvedValue([boosting]);
            listAll.mockResolvedValue(inAction);
            getProductsPrices.mockResolvedValue(prices);
            getFreeProductCount.mockResolvedValue(counts);
            update.mockRejectedValue(new Error('API Error'));
            await expect(service.unfitProductsRemoval(1)).rejects.toThrow('API Error');
        });
    });

    describe('fitProductsAddition', () => {
        const candidates = [
            product(1, { maxActionPrice: 50, actionPrice: 45, stock: 10 }),
            product(2, { maxActionPrice: 100, actionPrice: 85, stock: 20 }),
            product(3, { maxActionPrice: 150, actionPrice: 100, stock: 30 }), // мин. цена выше предельной → мимо
        ];
        const prices = [
            { id: 1, price: { min_price: 40 } },
            { id: 2, price: { min_price: 90 } },
            { id: 3, price: { min_price: 160 } },
        ] as any;
        const counts = [1, 2, 3].map((id) => ({ id, count: 1 }));

        beforeEach(() => {
            listAll.mockResolvedValue(candidates);
            getProductsPrices.mockResolvedValue(prices);
            getFreeProductCount.mockResolvedValue(counts);
        });

        it.each([
            [FitProductsStrategy.MAX_ACTION_PRICE, [50, 100]],
            [FitProductsStrategy.MAX_FROM_ACTION_PRICE_AND_MIN_PRICE, [45, 90]],
            [FitProductsStrategy.MIN_FROM_MIN_PRICE, [40, 90]],
        ])('стратегия %s → цены %j', async (strategy, expected) => {
            expect(await service.fitProductsAddition(1, strategy)).toBe(2);
            expect(listAll).toHaveBeenCalledWith('candidates', 1);
            expect(update).toHaveBeenCalledWith(1, [
                { productId: 1, actionPrice: expected[0], stock: 10 },
                { productId: 2, actionPrice: expected[1], stock: 20 },
            ]);
        });

        it('без остатка не добавляем', async () => {
            getFreeProductCount.mockResolvedValue([
                { id: 1, count: 0 },
                { id: 2, count: 5 },
                { id: 3, count: 0 },
            ]);
            expect(await service.fitProductsAddition(1, FitProductsStrategy.MAX_ACTION_PRICE)).toBe(1);
            expect(update).toHaveBeenCalledWith(1, [{ productId: 2, actionPrice: 100, stock: 20 }]);
        });
    });

    describe('addRemoveProductToActions / update.promos', () => {
        const prices = [
            { product_id: 1, min_price: 100, fboCount: 5, fbsCount: 3 },
            { product_id: 2, min_price: 200, fboCount: 2, fbsCount: 1 },
            { product_id: 3, min_price: 300, fboCount: 0, fbsCount: 4 },
        ];

        it('участник с ценой акции ≤ минимальной снимается, кандидат с лимитом ≥ минимальной добавляется', async () => {
            listActions.mockResolvedValue([boosting, { id: 2, is_voucher_action: false }]);
            index.mockResolvedValue({ data: prices });
            listAll
                .mockResolvedValueOnce([
                    product(1, { actionPrice: 90, maxActionPrice: 100, stock: 5 }),
                    product(2, { actionPrice: 220, maxActionPrice: 250, stock: 3 }),
                ])
                .mockResolvedValueOnce([
                    product(2, { maxActionPrice: 250, stock: 3 }),
                    product(3, { maxActionPrice: 350, stock: 4 }),
                ])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);
            update
                .mockResolvedValueOnce(okUpdate({ removed: [1] })) // снятие в акции 1
                .mockResolvedValueOnce(okUpdate({ added: [2, 3], rejected: [{ productId: 3, reason: 'x' }] })); // добавление

            const result = await service.addRemoveProductToActions(['SKU1', 'SKU2', 'SKU3']);

            expect(update).toHaveBeenNthCalledWith(1, 1, [{ productId: 1, actionPrice: 100, stock: 5 }]);
            expect(update).toHaveBeenNthCalledWith(2, 1, [
                { productId: 2, actionPrice: 250, stock: 3 },
                { productId: 3, actionPrice: 350, stock: 4 },
            ]);
            // по пустой акции шлюз получает пустой список — HTTP он сам не делает (см. promos.api.spec)
            expect(update).toHaveBeenNthCalledWith(3, 2, []);
            expect(update).toHaveBeenCalledTimes(3);
            expect(result).toEqual([
                {
                    action_id: 1,
                    removed: { success_ids: [1], failed: [] },
                    added: { success_ids: [2, 3], failed: [{ productId: 3, reason: 'x' }] },
                },
                { action_id: 2, removed: { success_ids: [], failed: [] }, added: { success_ids: [], failed: [] } },
            ]);
        });

        it('цены запрашиваются чанками по chunkLimit', async () => {
            listActions.mockResolvedValue([]);
            index.mockResolvedValue({ data: [] });
            await service.addRemoveProductToActions(['a', 'b', 'c'], 2);
            expect(index).toHaveBeenCalledTimes(2);
            expect(index.mock.calls[0][0]).toMatchObject({ offer_id: ['a', 'b'], limit: 2 });
        });

        it('событие update.promos → пересмотр по полученным артикулам', async () => {
            const spy = jest.spyOn(service, 'addRemoveProductToActions').mockResolvedValue([]);
            await service.handleUpdatePromos(['sku1']);
            expect(spy).toHaveBeenCalledWith(['sku1']);
        });
    });
});
