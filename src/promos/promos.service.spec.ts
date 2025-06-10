import { Test, TestingModule } from '@nestjs/testing';
import { FitProductsStrategy, PromosService } from './promos.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';
import { ProductService } from '../product/product.service';
import { ActionListProduct } from './dto/actionsCandidate.dto';
import { PriceService } from '../price/price.service';
import { ActionsDto } from './dto/actions.dto';

describe('PromosService', () => {
    let service: PromosService;
    let productService: ProductService;

    const method = jest.fn();
    const index = jest.fn();
    const getFreeProductCount = jest.fn();
    const getProductsPrices = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PromosService,
                { provide: OzonApiService, useValue: { method } },
                { provide: PriceService, useValue: { index } },
                { provide: ProductService, useValue: { getFreeProductCount, getProductsPrices } },
            ],
        }).compile();

        method.mockClear();
        index.mockClear();
        getProductsPrices.mockClear();
        service = module.get<PromosService>(PromosService);
        productService = module.get<ProductService>(ProductService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should retrieve actions', async () => {
        method.mockResolvedValue({ result: [] });
        await service.getActions();
        expect(method.mock.calls[0]).toEqual(['/v1/actions', {}, 'get']);
    });

    it('should retrieve action candidates', async () => {
        const params: ActionsListParamsDto = { action_id: 1, limit: 10, offset: 0 };
        method.mockResolvedValue({ result: [] });
        await service.getActionsCandidates(params);
        expect(method.mock.calls[0]).toEqual(['/v1/actions/candidates', params]);
    });

    it('should retrieve action products', async () => {
        const params: ActionsListParamsDto = { action_id: 1, limit: 10, offset: 0 };
        method.mockResolvedValue({ result: [] });
        await service.getActionsProducts(params);
        expect(method.mock.calls[0]).toEqual(['/v1/actions/products', params]);
    });

    it('should activate action products', async () => {
        const params: ActivateActionProductsParamsDto = { action_id: 1, products: [] };
        method.mockResolvedValue({ result: [] });
        await service.activateActionProducts(params);
        expect(method.mock.calls[0]).toEqual(['/v1/actions/products/activate', params]);
    });

    it('should deactivate action products', async () => {
        const params: DeactivateActionProductsParamsDto = { action_id: 1, product_ids: [1, 2, 3] };
        method.mockResolvedValue({ result: [] });
        await service.deactivateActionProducts(params);
        expect(method.mock.calls[0]).toEqual(['/v1/actions/products/deactivate', params]);
    });

    it('getAllActionsProductsOrCandidates should retrieve all action products with pagination', async () => {
        const actionId = 1;
        const limit = 2;
        const productsPage1 = { products: [{ id: 1 }, { id: 2 }], total: 4 };
        const productsPage2 = { products: [{ id: 3 }, { id: 4 }], total: 4 };
        const productsPage3 = { products: [] };

        method
            .mockResolvedValueOnce({ result: productsPage1 })
            .mockResolvedValueOnce({ result: productsPage2 })
            .mockResolvedValueOnce({ result: productsPage3 });

        const result = await service.getAllActionsProductsOrCandidates(actionId, 'products', limit);

        expect(result).toEqual([...productsPage1.products, ...productsPage2.products]);
        expect(method).toHaveBeenCalledTimes(3);
        expect(method).toHaveBeenCalledWith('/v1/actions/products', { action_id: actionId, limit, offset: 0 });
        expect(method).toHaveBeenCalledWith('/v1/actions/products', { action_id: actionId, limit, offset: limit });
    });

    it('getAllActionsProductsOrCandidates should retrieve all action candidates with pagination', async () => {
        const actionId = 1;
        const limit = 2;
        const candidatesPage1 = { products: [{ id: 1 }, { id: 2 }], total: 4 };
        const candidatesPage2 = { products: [{ id: 3 }, { id: 4 }], total: 4 };
        const candidatesPage3 = { products: [], total: 4 };

        method
            .mockResolvedValueOnce({ result: candidatesPage1 })
            .mockResolvedValueOnce({ result: candidatesPage2 })
            .mockResolvedValueOnce({ result: candidatesPage3 });

        const result = await service.getAllActionsProductsOrCandidates(actionId, 'candidates', limit);

        expect(result).toEqual([...candidatesPage1.products, ...candidatesPage2.products]);
        expect(method).toHaveBeenCalledTimes(3);
        expect(method).toHaveBeenCalledWith('/v1/actions/candidates', { action_id: actionId, limit, offset: 0 });
        expect(method).toHaveBeenCalledWith('/v1/actions/candidates', { action_id: actionId, limit, offset: limit });
    });

    it('getAllActionsProductsOrCandidates should return an empty array if no products are found', async () => {
        const actionId = 1;
        const limit = 2;
        const emptyProducts = { products: [], total: 0 };

        method.mockResolvedValueOnce({ result: emptyProducts });

        const result = await service.getAllActionsProductsOrCandidates(actionId, 'products', limit);

        expect(result).toEqual([]);
        expect(method).toHaveBeenCalledTimes(1);
        expect(method).toHaveBeenCalledWith('/v1/actions/products', { action_id: actionId, limit, offset: 0 });
    });

    it('should remove unfit products', async () => {
        const actionId = 1;
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
            { id: 3, action_price: 150 },
            { id: 4, action_price: 100 },
        ] as ActionListProduct[];
        const productPrices = [
            { id: 1, price: { min_price: 60 } },
            { id: 2, price: { min_price: 90 } },
            { id: 3, price: { min_price: 170 } },
            { id: 4, price: { min_price: 90 } },
        ] as any;
        const productCounts = [
            { id: 1, count: 1 },
            { id: 2, count: 1 },
            { id: 3, count: 1 },
            { id: 4, count: 0 },
        ];

        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionProducts);
        getFreeProductCount.mockResolvedValueOnce(productCounts);
        getProductsPrices.mockResolvedValueOnce(productPrices);
        jest.spyOn(service, 'deactivateActionProducts').mockResolvedValueOnce({ product_ids: [1, 3, 4], rejected: [] });

        const result = await service.unfitProductsRemoval(actionId);

        expect(result).toBe(3);
        expect(service.deactivateActionProducts).toHaveBeenCalledWith({
            action_id: actionId,
            product_ids: [1, 3, 4],
        });
    });

    it('should add fit products with maxActionPrice strategy', async () => {
        const actionId = 1;
        const actionCandidates = [
            { id: 1, max_action_price: 50, stock: 10 },
            { id: 2, max_action_price: 100, stock: 20 },
            { id: 3, max_action_price: 150, stock: 30 },
        ] as any;
        const candidatesPrice = [
            { id: 1, price: { min_price: 40 } },
            { id: 2, price: { min_price: 90 } },
            { id: 3, price: { min_price: 160 } },
        ] as any;
        const productCounts = [
            { id: 1, count: 1 },
            { id: 2, count: 1 },
            { id: 3, count: 1 },
        ];

        getFreeProductCount.mockResolvedValueOnce(productCounts);
        getProductsPrices.mockResolvedValueOnce(candidatesPrice);
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionCandidates);
        const activateActionProductsSpy = jest.spyOn(service, 'activateActionProducts').mockResolvedValueOnce(void 0);

        const result = await service.fitProductsAddition(actionId, FitProductsStrategy.MAX_ACTION_PRICE);

        expect(result).toBe(2);

        expect(activateActionProductsSpy).toHaveBeenCalledWith({
            action_id: actionId,
            products: [
                { product_id: 1, action_price: 50, stock: 10 },
                { product_id: 2, action_price: 100, stock: 20 },
            ],
        });
    });

    it('should add fit products with maxFromActionActionPiceAndProdMinPrice strategy', async () => {
        const actionId = 1;
        const actionCandidates = [
            { id: 1, max_action_price: 50, stock: 10, action_price: 45 },
            { id: 2, max_action_price: 100, stock: 20, action_price: 85 },
            { id: 3, max_action_price: 150, stock: 30, action_price: 100 },
        ] as any;
        const candidatesPrice = [
            { id: 1, price: { min_price: 40 } },
            { id: 2, price: { min_price: 90 } },
            { id: 3, price: { min_price: 160 } },
        ] as any;

        const productCounts = [
            { id: 1, count: 1 },
            { id: 2, count: 1 },
            { id: 3, count: 1 },
        ];

        getFreeProductCount.mockResolvedValueOnce(productCounts);
        getProductsPrices.mockResolvedValueOnce(candidatesPrice);
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionCandidates);
        const activateActionProductsSpy = jest.spyOn(service, 'activateActionProducts').mockResolvedValueOnce(void 0);

        const result = await service.fitProductsAddition(
            actionId,
            FitProductsStrategy.MAX_FROM_ACTION_PRICE_AND_MIN_PRICE,
        );

        expect(result).toBe(2);

        expect(activateActionProductsSpy).toHaveBeenCalledWith({
            action_id: actionId,
            products: [
                { product_id: 1, action_price: 45, stock: 10 },
                { product_id: 2, action_price: 90, stock: 20 },
            ],
        });
    });

    it('should add fit products with minFromProdMinPrice strategy', async () => {
        const actionId = 1;
        const actionCandidates = [
            { id: 1, max_action_price: 50, stock: 10 },
            { id: 2, max_action_price: 100, stock: 20 },
            { id: 3, max_action_price: 150, stock: 30 },
        ] as any;
        const candidatesPrice = [
            { id: 1, price: { min_price: 40 } },
            { id: 2, price: { min_price: 90 } },
            { id: 3, price: { min_price: 160 } },
        ] as any;
        const productCounts = [
            { id: 1, count: 1 },
            { id: 2, count: 1 },
            { id: 3, count: 1 },
        ];

        getFreeProductCount.mockResolvedValueOnce(productCounts);
        getProductsPrices.mockResolvedValueOnce(candidatesPrice);
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionCandidates);
        const activateActionProductsSpy = jest.spyOn(service, 'activateActionProducts').mockResolvedValueOnce(void 0);

        const result = await service.fitProductsAddition(actionId, FitProductsStrategy.MIN_FROM_MIN_PRICE);

        expect(result).toBe(2);
        expect(activateActionProductsSpy).toHaveBeenCalledWith({
            action_id: actionId,
            products: [
                { product_id: 1, action_price: 40, stock: 10 },
                { product_id: 2, action_price: 90, stock: 20 },
            ],
        });
    });

    it('should add fit products', async () => {
        const actionId = 123;
        const candidates = [
            { id: 1, max_action_price: 50, stock: 10 },
            { id: 2, max_action_price: 100, stock: 20 },
            { id: 3, max_action_price: 150, stock: 30 },
        ] as any;
        const prices = [
            { id: 1, price: { min_price: 50 } },
            { id: 2, price: { min_price: 80 } },
            { id: 3, price: { min_price: 160 } },
        ] as any;
        const freeCounts = [
            { id: 1, count: 10 },
            { id: 2, count: 5 },
            { id: 3, count: 0 },
        ];

        getFreeProductCount.mockResolvedValueOnce(freeCounts);
        getProductsPrices.mockResolvedValueOnce(prices);
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(candidates);
        const activateActionProductsSpy = jest.spyOn(service, 'activateActionProducts').mockResolvedValueOnce(void 0);

        const result = await service.fitProductsAddition(actionId, FitProductsStrategy.MAX_ACTION_PRICE);

        expect(result).toBe(2);
        expect(activateActionProductsSpy).toHaveBeenCalledWith({
            action_id: actionId,
            products: [
                { product_id: 1, action_price: 50, stock: 10 },
                { product_id: 2, action_price: 100, stock: 20 },
            ],
        });
    });

    it('unfitProductsRemoval should remove products with higher prices', async () => {
        // Arrange
        const actionId = 1;
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
            { id: 3, action_price: 150 },
        ] as ActionListProduct[];

        const productPrices = [
            { id: 1, price: { min_price: 60 } },  // Должен быть удален (60 > 50)
            { id: 2, price: { min_price: 100 } }, // Остается (100 = 100)
            { id: 3, price: { min_price: 160 } }, // Должен быть удален (160 > 150)
        ];

        // Act
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionProducts);
        getProductsPrices.mockResolvedValueOnce(productPrices);
        getFreeProductCount.mockResolvedValueOnce([
            { id: 1, count: 1 },
            { id: 2, count: 1 },
            { id: 3, count: 1 },
        ]);
        jest.spyOn(service, 'deactivateActionProducts').mockResolvedValueOnce({ product_ids: [1, 3], rejected: [] });

        const removedCount = await service.unfitProductsRemoval(actionId);

        // Assert
        expect(removedCount).toBe(2);
        expect(service.deactivateActionProducts).toHaveBeenCalledWith({ action_id: actionId, product_ids: [1, 3] });
    });

    it('unfitProductsRemoval should handle empty product list', async () => {
        // Arrange
        const actionId = 1;
        const actionProducts = [] as ActionListProduct[];

        // Act
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionProducts);
        getProductsPrices.mockResolvedValueOnce([]);
        getFreeProductCount.mockResolvedValueOnce([]);
        jest.spyOn(service, 'deactivateActionProducts').mockResolvedValueOnce({ product_ids: [], rejected: [] });

        const removedCount = await service.unfitProductsRemoval(actionId);

        // Assert
        expect(removedCount).toBe(0);
        expect(service.deactivateActionProducts).toHaveBeenCalledWith({ action_id: actionId, product_ids: [] });
    });

    it('unfitProductsRemoval should handle all products being removed', async () => {
        // Arrange
        const actionId = 1;
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
        ] as ActionListProduct[];

        const productPrices = [
            { id: 1, price: { min_price: 60 } },  // Должен быть удален (60 > 50)
            { id: 2, price: { min_price: 110 } }, // Должен быть удален (110 > 100)
        ];

        // Act
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionProducts);
        getProductsPrices.mockResolvedValueOnce(productPrices);
        getFreeProductCount.mockResolvedValueOnce([
            { id: 1, count: 1 },
            { id: 2, count: 1 },
        ]);
        jest.spyOn(service, 'deactivateActionProducts').mockResolvedValueOnce({ product_ids: [1, 2], rejected: [] });

        const removedCount = await service.unfitProductsRemoval(actionId);

        // Assert
        expect(removedCount).toBe(2);
        expect(service.deactivateActionProducts).toHaveBeenCalledWith({ action_id: actionId, product_ids: [1, 2] });
    });

    it('unfitProductsRemoval should handle no products being removed', async () => {
        // Arrange
        const actionId = 1;
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
        ] as ActionListProduct[];

        const productPrices = [
            { id: 1, price: { min_price: 40 } },  // Остается (40 < 50)
            { id: 2, price: { min_price: 90 } },  // Остается (90 < 100)
        ];

        // Act
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionProducts);
        getProductsPrices.mockResolvedValueOnce(productPrices);
        getFreeProductCount.mockResolvedValueOnce([
            { id: 1, count: 1 },
            { id: 2, count: 1 },
        ]);
        jest.spyOn(service, 'deactivateActionProducts').mockResolvedValueOnce({ product_ids: [], rejected: [] });

        const removedCount = await service.unfitProductsRemoval(actionId);

        // Assert
        expect(removedCount).toBe(0);
        expect(service.deactivateActionProducts).toHaveBeenCalledWith({ action_id: actionId, product_ids: [] });
    });

    it('unfitProductsRemoval should handle API errors', async () => {
        // Arrange
        const actionId = 1;
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
        ] as ActionListProduct[];

        const productPrices = [
            { id: 1, price: { min_price: 60 } },  // Должен быть удален (60 > 50)
            { id: 2, price: { min_price: 110 } }, // Должен быть удален (110 > 100)
        ];

        // Act
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionProducts);
        getProductsPrices.mockResolvedValueOnce(productPrices);
        getFreeProductCount.mockResolvedValueOnce([
            { id: 1, count: 1 },
            { id: 2, count: 1 },
        ]);
        jest.spyOn(service, 'deactivateActionProducts').mockRejectedValueOnce(new Error('API Error'));

        // Assert
        await expect(service.unfitProductsRemoval(actionId)).rejects.toThrow('API Error');
    });

    it('getActionListProduct should work correctly', async () => {
        const actionId = 1;
        const limit = 2;
        const mockSource = jest.fn();

        // Имитируем постраничные ответы с общим количеством 5 элементов
        mockSource
            .mockResolvedValueOnce({ products: [{ id: 1 }, { id: 2 }], total: 5 })
            .mockResolvedValueOnce({ products: [{ id: 3 }, { id: 4 }], total: 5 })
            .mockResolvedValueOnce({ products: [{ id: 5 }], total: 5 });

        const result = await service.getActionListProduct(mockSource, actionId, limit);

        // Проверяем собранный результат
        expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);

        // Проверяем правильность вызовов с пагинацией
        expect(mockSource).toHaveBeenCalledTimes(3);
        expect(mockSource).toHaveBeenNthCalledWith(1, { action_id: actionId, limit, offset: 0 });
        expect(mockSource).toHaveBeenNthCalledWith(2, { action_id: actionId, limit, offset: 2 });
        expect(mockSource).toHaveBeenNthCalledWith(3, { action_id: actionId, limit, offset: 4 });
    });

    it('addRemoveProductToActions should add and remove products correctly', async () => {
        // Подготовка тестовых данных
        const testIds = ['SKU1', 'SKU2', 'SKU3'];
        const actions = [
            {
                id: 1,
                title: 'Action 1',
            },
            {
                id: 2,
                title: 'Action 2',
            },
        ] as ActionsDto[];

        // Моки для цен
        const prices = [
            { product_id: 1, min_price: 100, fboCount: 5, fbsCount: 3 },
            { product_id: 2, min_price: 200, fboCount: 2, fbsCount: 1 },
            { product_id: 3, min_price: 300, fboCount: 0, fbsCount: 4 },
        ];

        // Товары в акции
        const productsInAction = [
            {
                id: 1,
                price: 90,
                action_price: 90,
                max_action_price: 100,
                add_mode: 'NORMAL',
                min_stock: 1,
                stock: 5,
            },
            {
                id: 2,
                price: 220,
                action_price: 220,
                max_action_price: 250,
                add_mode: 'NORMAL',
                min_stock: 1,
                stock: 3,
            },
        ] as ActionListProduct[];

        // Кандидаты на добавление
        const productsCanPromoted = [
            {
                id: 2,
                price: 220,
                action_price: 220,
                max_action_price: 250,
                add_mode: 'NORMAL',
                min_stock: 1,
                stock: 3,
            },
            {
                id: 3,
                price: 300,
                action_price: 300,
                max_action_price: 350,
                add_mode: 'NORMAL',
                min_stock: 1,
                stock: 4,
            },
        ] as ActionListProduct[];

        // Мокируем методы сервиса
        jest.spyOn(service, 'getActions').mockResolvedValue(actions);
        jest.spyOn(service, 'getActionListProduct')
            .mockResolvedValueOnce(productsInAction) // для первой акции - активные продукты
            .mockResolvedValueOnce(productsCanPromoted) // для первой акции - кандидаты
            .mockResolvedValueOnce([]) // для второй акции - активные продукты
            .mockResolvedValueOnce([]); // для второй акции - кандидаты

        jest.spyOn(service, 'deactivateActionProducts').mockResolvedValue({ product_ids: [1], rejected: [] });

        jest.spyOn(service, 'activateActionProducts').mockResolvedValue({ product_ids: [3], rejected: [] });

        // Мок для priceService
        index.mockResolvedValue({ data: prices });

        // Вызов тестируемого метода
        const result = await service.addRemoveProductToActions(testIds);

        // Проверки
        expect(result).toHaveLength(2);

        // Проверяем результат для первой акции
        expect(result[0]).toEqual({
            action_id: 1,
            removed: {
                success_ids: [1],
                failed: [],
            },
            added: {
                success_ids: [3],
                failed: [],
            },
        });

        // Проверяем результат для второй акции (пустой)
        expect(result[1]).toEqual({
            action_id: 2,
            removed: {
                success_ids: [],
                failed: [],
            },
            added: {
                success_ids: [],
                failed: [],
            },
        });

        // Проверяем вызовы методов
        expect(service.getActions).toHaveBeenCalled();
        expect(service.deactivateActionProducts).toHaveBeenCalledWith({
            action_id: 1,
            product_ids: [1],
        });
        expect(service.activateActionProducts).toHaveBeenCalledWith({
            action_id: 1,
            products: [
                {
                    product_id: 2,
                    action_price: 250,
                    stock: 3,
                },
                {
                    product_id: 3,
                    action_price: 350,
                    stock: 4,
                },
            ],
        });
    });
});
