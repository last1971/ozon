import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SyliusPriceService } from './sylius.price.service';
import { SyliusApiService } from '../sylius/sylius.api.service';
import { SyliusProductService } from '../sylius/sylius.product.service';
import { GOOD_SERVICE } from '../interfaces/IGood';

describe('SyliusPriceService', () => {
    let service: SyliusPriceService;
    let mockApi: jest.Mocked<SyliusApiService>;
    let mockSyliusProductService: jest.Mocked<SyliusProductService>;
    let mockGoodService: any;

    beforeEach(async () => {
        mockApi = {
            method: jest.fn().mockResolvedValue({}),
        } as any;

        mockSyliusProductService = {
            getGoodIds: jest.fn().mockResolvedValue({ goods: new Map([['SKU1', 1]]), nextArgs: null }),
            skuList: ['SKU1', 'SKU2'],
        } as any;

        mockGoodService = {
            updatePriceForService: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SyliusPriceService,
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key: string, defaultValue: any) => {
                            const config: Record<string, any> = {
                                SYLIUS_MIN_MIL: 0,
                                SYLIUS_PERC_MIL: 0,
                                SYLIUS_PERC_EKV: 0,
                                SYLIUS_SUM_OBTAIN: 0,
                                SUM_LABEL: 2,
                                TAX_UNIT: 6,
                                SYLIUS_EXT_PERC: 0,
                                SYLIUS_CHANNEL: 'default',
                            };
                            return config[key] ?? defaultValue;
                        }),
                    },
                },
                { provide: GOOD_SERVICE, useValue: mockGoodService },
                { provide: SyliusApiService, useValue: mockApi },
                { provide: SyliusProductService, useValue: mockSyliusProductService },
            ],
        }).compile();

        service = module.get<SyliusPriceService>(SyliusPriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getObtainCoeffs', () => {
        it('should return coefficients from config', () => {
            const coeffs = service.getObtainCoeffs();
            expect(coeffs).toEqual({
                minMil: 0,
                percMil: 0,
                percEkv: 0,
                sumObtain: 0,
                sumLabel: 2,
                taxUnit: 6,
            });
        });
    });

    describe('getProductsWithCoeffs', () => {
        it('should return adapters for skus', async () => {
            const result = await service.getProductsWithCoeffs(['SKU1', 'SKU2']);
            expect(result).toHaveLength(2);
            expect(result[0].getSku()).toBe('SKU1');
            expect(result[0].getSalesPercent()).toBe(0);
            expect(result[0].getTransMaxAmount()).toBe(0);
        });
    });

    describe('updatePrices', () => {
        it('should update prices via batch API', async () => {
            mockApi.method.mockResolvedValue({ updated: 2, notFound: 0 });

            const updatePrices = [
                { offer_id: 'SKU1', price: '100', old_price: '120', min_price: '90' },
                { offer_id: 'SKU2', price: '200', old_price: '240', min_price: '180' },
            ];

            await service.updatePrices(updatePrices as any);

            expect(mockApi.method).toHaveBeenCalledTimes(1);
            expect(mockApi.method).toHaveBeenCalledWith(
                '/api/v2/admin/price/update',
                'post',
                {
                    prices: {
                        SKU1: { price: 10000, originalPrice: 12000, minimumPrice: 9000 },
                        SKU2: { price: 20000, originalPrice: 24000, minimumPrice: 18000 },
                    },
                },
            );
        });

        it('should skip SKUs not in skuList', async () => {
            const updatePrices = [
                { offer_id: 'UNKNOWN_SKU', price: '100', old_price: '120', min_price: '90' },
            ];

            const result = await service.updatePrices(updatePrices as any);

            expect(mockApi.method).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        it('should handle API errors', async () => {
            mockApi.method.mockRejectedValueOnce(new Error('API Error'));

            const updatePrices = [
                { offer_id: 'SKU1', price: '100', old_price: '120', min_price: '90' },
            ];

            const result = await service.updatePrices(updatePrices as any);

            expect(result).toHaveLength(1);
            expect(result[0].error).toBe('API Error');
        });

        it('should return empty array for empty input', async () => {
            const result = await service.updatePrices([]);
            expect(result).toEqual([]);
        });
    });

    describe('updateAllPrices', () => {
        it('should update prices for all goods from Sylius', async () => {
            await service.updateAllPrices();

            expect(mockSyliusProductService.getGoodIds).toHaveBeenCalled();
            expect(mockGoodService.updatePriceForService).toHaveBeenCalledWith(service, ['SKU1']);
        });

        it('should handle pagination', async () => {
            mockSyliusProductService.getGoodIds
                .mockResolvedValueOnce({ goods: new Map([['SKU1', 1]]), nextArgs: { page: 2 } })
                .mockResolvedValueOnce({ goods: new Map([['SKU2', 1]]), nextArgs: null });

            await service.updateAllPrices();

            expect(mockSyliusProductService.getGoodIds).toHaveBeenCalledTimes(2);
            expect(mockGoodService.updatePriceForService).toHaveBeenCalledTimes(2);
        });
    });
});
