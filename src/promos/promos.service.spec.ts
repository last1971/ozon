import { Test, TestingModule } from '@nestjs/testing';
import { PromosService } from './promos.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';
import { ProductService } from '../product/product.service';

describe('PromosService', () => {
    let service: PromosService;

    const method = jest.fn();
    const getPrices = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PromosService,
                { provide: OzonApiService, useValue: { method } },
                { provide: ProductService, useValue: { getPrices } },
            ],
        }).compile();

        method.mockClear();
        getPrices.mockClear();
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

    it('should remove unfit products', async () => {
        const actionId = 1;
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
            { id: 3, action_price: 150 },
        ];
        const productPrices = [
            { product_id: 1, price: { min_price: 60 } },
            { product_id: 2, price: { min_price: 90 } },
            { product_id: 3, price: { min_price: 160 } },
        ];

        method.mockResolvedValueOnce({ result: { products: actionProducts, total: 3 } });
        getPrices.mockResolvedValueOnce({ items: productPrices });

        const unfitProductsCount = await service.unfitProductsRemoval(actionId);

        expect(unfitProductsCount).toBe(2);
        expect(method.mock.calls[1]).toEqual([
            '/v1/actions/products/deactivate',
            { action_id: actionId, product_ids: [1, 3] },
        ]);
    });
});
