import { Test, TestingModule } from '@nestjs/testing';
import { PromosService } from './promos.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ActionsListParamsDto } from './dto/actionsCandidateParams.dto';
import { ActivateActionProductsParamsDto } from './dto/activateActionProductsParams.dbo';
import { DeactivateActionProductsParamsDto } from './dto/deactivateActionProductsParams.dbo';

describe('PromosService', () => {
    let service: PromosService;

    const method = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [PromosService, { provide: OzonApiService, useValue: { method } }],
        }).compile();

        method.mockClear();
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
        const params: DeactivateActionProductsParamsDto = { action_id: 1, products: [1, 2, 3] };
        method.mockResolvedValue({ result: [] });
        await service.deactivateActionProducts(params);
        expect(method.mock.calls[0]).toEqual(['/v1/actions/products/deactivate', params]);
    });
});
