import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SyliusProductService } from './sylius.product.service';
import { SyliusApiService } from './sylius.api.service';
import { GoodServiceEnum } from '../good/good.service.enum';

describe('SyliusProductService', () => {
    let service: SyliusProductService;
    let apiService: jest.Mocked<SyliusApiService>;
    let configService: jest.Mocked<ConfigService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SyliusProductService,
                {
                    provide: SyliusApiService,
                    useValue: {
                        method: jest.fn(),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<SyliusProductService>(SyliusProductService);
        apiService = module.get(SyliusApiService);
        configService = module.get(ConfigService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('onModuleInit', () => {
        it('should not load SKU list if SYLIUS not in SERVICES', async () => {
            configService.get.mockReturnValue([GoodServiceEnum.OZON]);
            const loadSkuListSpy = jest.spyOn(service, 'loadSkuList');

            await service.onModuleInit();

            expect(loadSkuListSpy).not.toHaveBeenCalled();
        });

        it('should load SKU list in production', async () => {
            configService.get
                .mockReturnValueOnce([GoodServiceEnum.SYLIUS])
                .mockReturnValueOnce('production');
            const loadSkuListSpy = jest.spyOn(service, 'loadSkuList').mockResolvedValue();

            await service.onModuleInit();

            expect(loadSkuListSpy).toHaveBeenCalledWith(true);
        });
    });

    describe('getGoodIds', () => {
        it('should fetch variants and return only numeric codes', async () => {
            apiService.method.mockResolvedValue({
                'hydra:member': [
                    { code: '560166', onHand: 10, onHold: 2 },
                    { code: 'test-product', onHand: 5, onHold: 0 },
                    { code: '123456', onHand: 20, onHold: 5 },
                ],
                'hydra:totalItems': 3,
            });

            const result = await service.getGoodIds({ page: 1 });

            expect(result.goods.size).toBe(2);
            expect(result.goods.get('560166')).toBe(10);
            expect(result.goods.get('123456')).toBe(20);
            expect(result.goods.has('test-product')).toBe(false);
            expect(result.nextArgs).toBeNull();
        });

        it('should handle pagination', async () => {
            apiService.method.mockResolvedValue({
                'hydra:member': Array(100).fill({ code: '123', onHand: 1, onHold: 0 }),
                'hydra:totalItems': 150,
            });

            const result = await service.getGoodIds({ page: 1 });

            expect(result.nextArgs).toEqual({ page: 2 });
        });

        it('should return null nextArgs on last page', async () => {
            apiService.method.mockResolvedValue({
                'hydra:member': [{ code: '123', onHand: 1, onHold: 0 }],
                'hydra:totalItems': 50,
            });

            const result = await service.getGoodIds({ page: 1 });

            expect(result.nextArgs).toBeNull();
        });

        it('should default to page 1', async () => {
            apiService.method.mockResolvedValue({
                'hydra:member': [],
                'hydra:totalItems': 0,
            });

            await service.getGoodIds(null);

            expect(apiService.method).toHaveBeenCalledWith(
                '/api/v2/admin/product-variants',
                'get',
                { itemsPerPage: 100, page: 1 },
            );
        });
    });

    describe('updateGoodCounts', () => {
        it('should update stock via API', async () => {
            apiService.method.mockResolvedValue({ updated: 2 });

            const goods = new Map([
                ['560166', 50],
                ['123456', 30],
            ]);

            const result = await service.updateGoodCounts(goods);

            expect(result).toBe(2);
            expect(apiService.method).toHaveBeenCalledWith(
                '/api/v2/admin/stock/update',
                'post',
                { goods: { '560166': 50, '123456': 30 } },
            );
        });

        it('should return 0 for empty goods', async () => {
            const result = await service.updateGoodCounts(new Map());

            expect(result).toBe(0);
            expect(apiService.method).not.toHaveBeenCalled();
        });
    });

    describe('infoList', () => {
        it('should return product info DTOs', async () => {
            const result = await service.infoList(['560166', '123456']);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                barCode: '',
                goodService: GoodServiceEnum.SYLIUS,
                id: '560166',
                primaryImage: '',
                remark: '',
                sku: '560166',
                fbsCount: 0,
                fboCount: 0,
            });
        });
    });
});
