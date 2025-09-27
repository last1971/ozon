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
            getAllAvitoIds: jest.fn(),
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
                '/core/v1/accounts/self/items/stock',
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
                '/core/v1/accounts/self/items/stock',
                { item_ids: [123], strong_consistency: false },
                'post'
            );
        });
    });

    describe('getGoodIds', () => {
        it('should return empty map when no avito ids exist', async () => {
            goodService.getAllAvitoIds.mockResolvedValue([]);

            const result = await service.getGoodIds(null);

            expect(goodService.getAllAvitoIds).toHaveBeenCalled();
            expect(result).toEqual({
                goods: new Map(),
                nextArgs: null,
            });
        });

        it('should process avito ids and return quantities', async () => {
            goodService.getAllAvitoIds.mockResolvedValue(['123', '456', '789']);
            avitoApiService.request.mockResolvedValue({
                stocks: [
                    { item_id: 123, quantity: 5, is_out_of_stock: false, is_unlimited: false, is_multiple: true },
                    { item_id: 456, quantity: 0, is_out_of_stock: true, is_unlimited: false, is_multiple: false },
                    { item_id: 789, quantity: 10, is_out_of_stock: false, is_unlimited: true, is_multiple: true },
                ],
            });

            const result = await service.getGoodIds(null);

            expect(goodService.getAllAvitoIds).toHaveBeenCalled();
            expect(avitoApiService.request).toHaveBeenCalledWith(
                '/core/v1/accounts/self/items/stock',
                { item_ids: [123, 456, 789], strong_consistency: true },
                'post'
            );

            const expectedMap = new Map([
                ['123', 5],
                ['789', 999999], // unlimited
                // '456' not included because is_out_of_stock = true
            ]);
            expect(result.goods).toEqual(expectedMap);
            expect(result.nextArgs).toBeNull();
        });

        it('should handle chunking for large number of ids', async () => {
            const largeIdArray = Array.from({ length: 250 }, (_, i) => (i + 1).toString());
            goodService.getAllAvitoIds.mockResolvedValue(largeIdArray);

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
            expect(result.goods.get('1')).toBe(1);
            expect(result.goods.get('250')).toBe(250);
        });
    });
});