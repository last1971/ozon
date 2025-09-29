import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AvitoCardService } from './avito.card.service';
import { AvitoApiService } from '../avito.api/avito.api.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { GoodServiceEnum } from '../good/good.service.enum';

describe('AvitoCardService', () => {
    let service: AvitoCardService;
    let avitoApiService: jest.Mocked<AvitoApiService>;
    let goodService: any;
    let configService: jest.Mocked<ConfigService>;

    beforeEach(async () => {
        const mockAvitoApi = {
            request: jest.fn(),
        };

        const mockGoodService = {
            getAllAvitoGoods: jest.fn(),
        };

        const mockConfigService = {
            get: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AvitoCardService,
                { provide: AvitoApiService, useValue: mockAvitoApi },
                { provide: GOOD_SERVICE, useValue: mockGoodService },
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<AvitoCardService>(AvitoCardService);
        avitoApiService = module.get(AvitoApiService);
        goodService = module.get(GOOD_SERVICE);
        configService = module.get(ConfigService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('onModuleInit', () => {
        it('should not initialize if AVITO service is not in config', async () => {
            configService.get.mockReturnValue([GoodServiceEnum.WB, GoodServiceEnum.OZON]);
            const loadSkuListSpy = jest.spyOn(service, 'loadSkuList');

            await service.onModuleInit();

            expect(configService.get).toHaveBeenCalledWith('SERVICES', []);
            expect(loadSkuListSpy).not.toHaveBeenCalled();
        });

        it('should initialize and load sku list in production', async () => {
            configService.get
                .mockReturnValueOnce([GoodServiceEnum.AVITO])
                .mockReturnValueOnce('production');
            const loadSkuListSpy = jest.spyOn(service, 'loadSkuList').mockResolvedValue();

            await service.onModuleInit();

            expect(configService.get).toHaveBeenCalledWith('SERVICES', []);
            expect(configService.get).toHaveBeenCalledWith('NODE_ENV');
            expect(loadSkuListSpy).toHaveBeenCalledWith(true);
        });

        it('should initialize and load sku list in development', async () => {
            configService.get
                .mockReturnValueOnce([GoodServiceEnum.AVITO])
                .mockReturnValueOnce('development');
            const loadSkuListSpy = jest.spyOn(service, 'loadSkuList').mockResolvedValue();

            await service.onModuleInit();

            expect(loadSkuListSpy).toHaveBeenCalledWith(false);
        });
    });

    describe('getStock', () => {
        it('should call avito api with correct parameters', async () => {
            const mockResponse = {
                stocks: [
                    { item_id: 123, quantity: 5, is_out_of_stock: false, is_unlimited: false, is_multiple: true },
                    { item_id: 456, quantity: 0, is_out_of_stock: true, is_unlimited: false, is_multiple: false },
                ],
            };
            avitoApiService.request.mockResolvedValue(mockResponse);

            const result = await service.getStock([123, 456]);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/info',
                { item_ids: [123, 456], strong_consistency: true },
                'post'
            );
            expect(result).toEqual(mockResponse);
        });

        it('should call avito api with custom strong_consistency', async () => {
            const mockResponse = { stocks: [] };
            avitoApiService.request.mockResolvedValue(mockResponse);

            await service.getStock([123], false);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/info',
                { item_ids: [123], strong_consistency: false },
                'post'
            );
        });
    });

    describe('getGoodIds', () => {
        it('should return empty map when no avito ids exist', async () => {
            goodService.getAllAvitoGoods.mockResolvedValue([]);

            const result = await service.getGoodIds(null);

            expect(goodService.getAllAvitoGoods).toHaveBeenCalled();
            expect(result).toEqual({
                goods: new Map(),
                nextArgs: null,
            });
        });

        it('should process avito ids and return quantities', async () => {
            goodService.getAllAvitoGoods.mockResolvedValue([
                { id: '123', goodsCode: '456', coeff: 1, commission: 10.0 },
                { id: '456', goodsCode: '789', coeff: 1, commission: 10.0 },
                { id: '789', goodsCode: '101', coeff: 1, commission: 10.0 },
            ]);
            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, quantity: 5, is_out_of_stock: false, is_unlimited: false, is_multiple: true },
                    { item_id: 456, quantity: 0, is_out_of_stock: true, is_unlimited: false, is_multiple: false },
                    { item_id: 789, quantity: 10, is_out_of_stock: false, is_unlimited: true, is_multiple: true },
                ],
            });

            const result = await service.getGoodIds(null);

            expect(goodService.getAllAvitoGoods).toHaveBeenCalled();
            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/info',
                { item_ids: [123, 456, 789], strong_consistency: true },
                'post'
            );

            const expectedMap = new Map([
                ['456', 5],
                ['101', 999999], 
                ['789', 0],
            ]);
            expect(result.goods).toEqual(expectedMap);
            expect(result.nextArgs).toBeNull();
        });

        it('should handle chunking for large number of ids', async () => {
            const largeIdArray = Array.from({ length: 250 }, (_, i) => ({
                id: (i + 1).toString(),
                goodsCode: `goods${i + 1}`,
                coeff: 1,
                commission: 10.0
            }));
            goodService.getAllAvitoGoods.mockResolvedValue(largeIdArray);

            avitoApiService.request
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 100 }, (_, i) => ({
                        item_id: i + 1,
                        quantity: i + 1,
                        is_out_of_stock: false,
                        is_unlimited: false,
                        is_multiple: true,
                    })),
                })
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 100 }, (_, i) => ({
                        item_id: i + 101,
                        quantity: i + 101,
                        is_out_of_stock: false,
                        is_unlimited: false,
                        is_multiple: true,
                    })),
                })
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 50 }, (_, i) => ({
                        item_id: i + 201,
                        quantity: i + 201,
                        is_out_of_stock: false,
                        is_unlimited: false,
                        is_multiple: true,
                    })),
                });

            const result = await service.getGoodIds(null);

            expect(avitoApiService.request).toHaveBeenCalledTimes(3);
            expect(result.goods.size).toBe(250);
            expect(result.goods.get('goods1')).toBe(1);
            expect(result.goods.get('goods250')).toBe(250);
        });
    });

    describe('updateGoodCounts', () => {
        beforeEach(() => {
            // Setup skuAvitoIdPair for testing
            service['skuAvitoIdPair'].set('goods1', '123');
            service['skuAvitoIdPair'].set('goods2', '456');
        });

        it('should return 0 when goods map is empty', async () => {
            const result = await service.updateGoodCounts(new Map());
            expect(result).toBe(0);
            expect(avitoApiService.request).not.toHaveBeenCalled();
        });

        it('should update stocks via API and return success count', async () => {
            const goods = new Map([
                ['goods1', 10],
                ['goods2', 20]
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null },
                    { item_id: 456, success: true, errors: [], external_id: null }
                ]
            });

            const result = await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/stocks',
                {
                    stocks: [
                        { item_id: 123, quantity: 10 },
                        { item_id: 456, quantity: 20 }
                    ]
                },
                'put'
            );
            expect(result).toBe(2);
        });

        it('should handle partial success responses', async () => {
            const goods = new Map([
                ['goods1', 10],
                ['goods2', 20]
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null },
                    { item_id: 456, success: false, errors: ['Some error'], external_id: null }
                ]
            });

            const result = await service.updateGoodCounts(goods);

            expect(result).toBe(1); // Only one successful
        });

        it('should limit quantities to 999999', async () => {
            const goods = new Map([
                ['goods1', 1000000] // Exceeds limit
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null }
                ]
            });

            await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/stocks',
                {
                    stocks: [
                        { item_id: 123, quantity: 999999 }
                    ]
                },
                'put'
            );
        });

        it('should handle chunking for large updates', async () => {
            // Create 250 goods
            const goods = new Map();
            for (let i = 1; i <= 250; i++) {
                goods.set(`goods${i}`, i);
                service['skuAvitoIdPair'].set(`goods${i}`, i.toString());
            }

            avitoApiService.request
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 200 }, (_, i) => ({
                        item_id: i + 1,
                        success: true,
                        errors: [],
                        external_id: null
                    }))
                })
                .mockResolvedValueOnce({
                    stocks: Array.from({ length: 50 }, (_, i) => ({
                        item_id: i + 201,
                        success: true,
                        errors: [],
                        external_id: null
                    }))
                });

            const result = await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledTimes(2);
            expect(result).toBe(250);
        });

        it('should handle API errors gracefully', async () => {
            const goods = new Map([['goods1', 10]]);

            avitoApiService.request.mockRejectedValue(new Error('API Error'));

            const result = await service.updateGoodCounts(goods);

            expect(result).toBe(0); // No successful updates due to error
        });

        it('should skip goods without valid Avito IDs', async () => {
            const goods = new Map([
                ['goods1', 10],        // Has valid ID
                ['unknown', 20]        // No ID mapping
            ]);

            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, success: true, errors: [], external_id: null }
                ]
            });

            const result = await service.updateGoodCounts(goods);

            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/stock-management/1/stocks',
                {
                    stocks: [
                        { item_id: 123, quantity: 10 }
                        // 'unknown' should be filtered out
                    ]
                },
                'put'
            );
            expect(result).toBe(1);
        });
    });
});