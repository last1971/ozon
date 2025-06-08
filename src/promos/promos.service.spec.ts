import { Test, TestingModule } from '@nestjs/testing';
import { FitProductsStrategy, PromosService } from './promos.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';
import { ProductService } from '../product/product.service';
import { ActionListProduct } from './dto/actionsCandidate.dto';

describe('PromosService', () => {
    let service: PromosService;

    const method = jest.fn();
    const getPrices = jest.fn();
    const index = jest.fn();
    const getFreeProductCount = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PromosService,
                { provide: OzonApiService, useValue: { method } },
                { provide: ProductService, useValue: { getPrices, getFreeProductCount } },
            ],
        }).compile();

        method.mockClear();
        getPrices.mockClear();
        index.mockClear();
        service = module.get<PromosService>(PromosService);
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

    it('getProductsPrices works', async () => {
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
            { id: 3, action_price: 150 },
            { id: 4, action_price: 100 },
        ] as ActionListProduct[];
        const productPrices = [
            { product_id: 1, price: { min_price: 50 } },
            { product_id: 2, price: { min_price: 100 } },
            { product_id: 3, price: { min_price: 150 } },
        ];
        const getPricesParams = { product_id: [1, 2, 3, 4], visibility: 'ALL', limit: 100 };

        getPrices.mockResolvedValue({ items: productPrices });

        const result = await service.getProductsPrices(actionProducts);

        expect(result).toEqual(productPrices.map((i) => ({ id: i.product_id, price: i.price })));
        expect(getPrices.mock.calls[0][0]).toEqual(getPricesParams);
    });

    it('getProductsPrices should handle multiple pages', async () => {
        const actionProducts = Array.from({ length: 250 }, (_, i) => ({
            id: i + 1,
            action_price: 100,
        })) as ActionListProduct[];
        const prodictPrices = actionProducts.map((product) => ({ product_id: product.id, price: { min_price: 100 } }));
        getPrices
            .mockResolvedValue({ items: prodictPrices.slice(0, 100) })
            .mockResolvedValueOnce({ items: prodictPrices.slice(100, 200) })
            .mockResolvedValueOnce({ items: prodictPrices.slice(200) });

        const result = await service.getProductsPrices(actionProducts, 100);

        expect(result.length).toEqual(prodictPrices.length);
        expect(getPrices).toHaveBeenCalledTimes(3);
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
        ] as any;
        const productCounts = [
            { id: 1, count: 1 },
            { id: 2, count: 1 },
            { id: 3, count: 1 },
            { id: 4, count: 0 },
        ];

        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionProducts);
        jest.spyOn(service, 'getProductsPrices').mockResolvedValueOnce(productPrices);
        getFreeProductCount.mockResolvedValueOnce(productCounts);
        jest.spyOn(service, 'deactivateActionProducts').mockResolvedValueOnce(void 0);

        const result = await service.unfitProductsRemoval(actionId);

        expect(result).toBe(2);
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
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionCandidates);
        jest.spyOn(service, 'getProductsPrices').mockResolvedValueOnce(candidatesPrice);
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
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionCandidates);
        jest.spyOn(service, 'getProductsPrices').mockResolvedValueOnce(candidatesPrice);
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
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(actionCandidates);
        jest.spyOn(service, 'getProductsPrices').mockResolvedValueOnce(candidatesPrice);
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
        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(candidates);
        jest.spyOn(service, 'getProductsPrices').mockResolvedValueOnce(prices);
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

    it('should remove unfit products', async () => {
        const actionId = 123;
        const products = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
            { id: 3, action_price: 150 },
            { id: 4, action_price: 200 },
        ] as ActionListProduct[];
        const prices = [
            { id: 1, price: { min_price: 60 } },
            { id: 2, price: { min_price: 80 } },
            { id: 3, price: { min_price: 170 } },
            { id: 4, price: { min_price: 190 } },
        ] as any;
        const freeCounts = [
            { id: 1, count: 0 }, // Product with zero count should be removed
            { id: 2, count: 1 },
            { id: 3, count: 0 }, // Product with price not meeting criteria
            { id: 4, count: 1 },
        ];

        jest.spyOn(service, 'getAllActionsProductsOrCandidates').mockResolvedValueOnce(products);
        jest.spyOn(service, 'getProductsPrices').mockResolvedValueOnce(prices);
        getFreeProductCount.mockResolvedValueOnce(freeCounts);
        const deactivateActionProductsSpy = jest
            .spyOn(service, 'deactivateActionProducts')
            .mockResolvedValueOnce(void 0);

        const result = await service.unfitProductsRemoval(actionId);

        expect(result).toBe(2);
        expect(deactivateActionProductsSpy).toHaveBeenCalledWith({
            action_id: actionId,
            product_ids: [1, 3],
        });
    });
});
