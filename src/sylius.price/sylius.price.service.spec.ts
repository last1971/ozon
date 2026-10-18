import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SyliusPriceService } from './sylius.price.service';
import { SyliusApiService } from '../sylius/sylius.api.service';
import { SyliusProductService } from '../sylius/sylius.product.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { IPriceable } from '../interfaces/i.priceable';

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
            skuList: ['SKU1', 'SKU2', '335594'],
        } as any;

        mockGoodService = {
            updatePriceForService: jest.fn().mockResolvedValue([]),
            getQuantityThresholds: jest.fn().mockResolvedValue(new Map()),
            buildPriceables: jest.fn().mockResolvedValue([]),
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
                                TAX_UNIT: 11,
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
                taxUnit: 11,
            });
        });
    });

    describe('getObtainCoeffs — свои этикетка и упаковка Sylius', () => {
        it('SYLIUS_SUM_LABEL / SYLIUS_SUM_PACK подменяют общие, ноль — тоже значение', async () => {
            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    SyliusPriceService,
                    {
                        provide: ConfigService,
                        useValue: {
                            get: jest.fn((key: string, defaultValue: any) => {
                                const config: Record<string, any> = {
                                    SUM_LABEL: 4,
                                    SYLIUS_SUM_LABEL: 0,
                                    SYLIUS_SUM_PACK: 0,
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
            const coeffs = module.get<SyliusPriceService>(SyliusPriceService).getObtainCoeffs();
            expect(coeffs.sumLabel).toBe(0);
            expect(coeffs.sumPack).toBe(0);
        });
        it('без SYLIUS_SUM_PACK подмены упаковки нет', () => {
            expect(service.getObtainCoeffs().sumPack).toBeUndefined();
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
        it('should update prices via batch API, без себестоимости ступени пустые', async () => {
            mockApi.method.mockResolvedValue({ updated: 2, notFound: 0 });

            const updatePrices = [
                { offer_id: 'SKU1', price: '100', old_price: '120', min_price: '90' },
                { offer_id: 'SKU2', price: '200', old_price: '240', min_price: '180' },
            ];

            await service.updatePrices(updatePrices as any);

            expect(mockApi.method).toHaveBeenCalledTimes(1);
            expect(mockApi.method).toHaveBeenCalledWith('/api/v2/admin/price/update', 'post', {
                prices: {
                    SKU1: { price: 10000, originalPrice: 12000, minimumPrice: 9000, tiers: [] },
                    SKU2: { price: 20000, originalPrice: 24000, minimumPrice: 18000, tiers: [] },
                },
            });
            expect(mockGoodService.buildPriceables).not.toHaveBeenCalled();
        });

        it('should skip SKUs not in skuList', async () => {
            const updatePrices = [{ offer_id: 'UNKNOWN_SKU', price: '100', old_price: '120', min_price: '90' }];

            const result = await service.updatePrices(updatePrices as any);

            expect(mockApi.method).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        it('should handle API errors', async () => {
            mockApi.method.mockRejectedValueOnce(new Error('API Error'));

            const updatePrices = [{ offer_id: 'SKU1', price: '100', old_price: '120', min_price: '90' }];

            const result = await service.updatePrices(updatePrices as any);

            expect(result).toHaveLength(1);
            expect(result[0].error).toBe('API Error');
        });

        it('should return empty array for empty input', async () => {
            const result = await service.updatePrices([]);
            expect(result).toEqual([]);
        });
    });

    describe('ступени цены от количества', () => {
        // Партия «код-N» с наценками: при УСН 11 %, этикетка 2 + упаковка 10 → calculatePrice даёт
        // price = ceil((cost·(1+perc/100) + 12) / 0.89), min_price — то же с min_perc
        const priceable = (offer_id: string, incoming_price: number, perc: number, min_perc: number): IPriceable => ({
            offer_id,
            incoming_price,
            available_price: 0,
            fbs_direct_flow_trans_max_amount: 0,
            sales_percent: 0,
            min_perc,
            perc,
            old_perc: perc * 2,
            adv_perc: 0,
            sum_pack: 10,
        });

        it('пороги по умолчанию от розничной цены (<50 → 10/100), партия от закупки × N, в ответ tiers', async () => {
            mockApi.method.mockResolvedValue({ updated: 1, notFound: 0, rejectedTiers: [] });
            mockGoodService.buildPriceables.mockResolvedValue([
                priceable('335594-10', 10, 100, 50), // price ceil(32/0.89)=36, min ceil(27/0.89)=31 → mid 33,5 → 3,35/шт
                priceable('335594-100', 100, 100, 50), // min ceil(162/0.89)=183 → 1,83/шт
            ]);

            await service.updatePrices([
                { offer_id: '335594', price: '40', old_price: '80', min_price: '20', incoming_price: 1 },
            ] as any);

            expect(mockGoodService.getQuantityThresholds).toHaveBeenCalledWith(['335594']);
            // buildPriceables получает подложенную себестоимость партии: закупка × N
            const [svc, skus, costs] = mockGoodService.buildPriceables.mock.calls[0];
            expect(svc).toBe(service);
            expect(skus).toEqual(['335594-10', '335594-100']);
            expect(costs.get('335594-10')).toMatchObject({ offer_id: '335594-10', incoming_price: 10 });
            expect(costs.get('335594-100')).toMatchObject({ offer_id: '335594-100', incoming_price: 100 });

            expect(mockApi.method).toHaveBeenCalledWith('/api/v2/admin/price/update', 'post', {
                prices: {
                    '335594': {
                        price: 4000,
                        originalPrice: 8000,
                        minimumPrice: 2000,
                        tiers: [
                            { quantity: 10, price: 335 },
                            { quantity: 100, price: 183 },
                        ],
                    },
                },
            });
        });

        it('рыночная цена важнее закупки, пороги из Trade, если 1 < мелкий < опт', async () => {
            mockApi.method.mockResolvedValue({ updated: 1, notFound: 0 });
            mockGoodService.getQuantityThresholds.mockResolvedValue(new Map([['335594', { mopt: 5, opt: 20 }]]));

            await service.updatePrices([
                {
                    offer_id: '335594',
                    price: '40',
                    old_price: '80',
                    min_price: '20',
                    incoming_price: 1,
                    available_price: 3,
                },
            ] as any);

            const [, skus, costs] = mockGoodService.buildPriceables.mock.calls[0];
            expect(skus).toEqual(['335594-5', '335594-20']);
            expect(costs.get('335594-5').incoming_price).toBe(15);
            expect(costs.get('335594-20').incoming_price).toBe(60);
        });

        it('ступень дороже обычной цены не уходит, остальные уходят', async () => {
            mockApi.method.mockResolvedValue({ updated: 1, notFound: 0 });
            mockGoodService.buildPriceables.mockResolvedValue([
                priceable('335594-10', 10, 1000, 900), // price ceil(122/0.89)=138, min ceil(112/0.89)=126 → 13,20/шт > 4
                priceable('335594-100', 100, 100, 50), // 1,83/шт
            ]);

            await service.updatePrices([
                { offer_id: '335594', price: '4', old_price: '8', min_price: '2', incoming_price: 1 },
            ] as any);

            const payload = mockApi.method.mock.calls[0][2];
            expect(payload.prices['335594'].tiers).toEqual([{ quantity: 100, price: 183 }]);
        });

        it('rejectedTiers из ответа Sylius — ошибки по кодам', async () => {
            mockApi.method.mockResolvedValue({ updated: 1, notFound: 0, rejectedTiers: ['335594'] });

            const result = await service.updatePrices([
                { offer_id: '335594', price: '40', old_price: '80', min_price: '20' },
            ] as any);

            expect(result).toEqual([{ offer_id: '335594', error: expect.stringContaining('отверг ступени') }]);
        });
    });

    describe('updateAllPrices', () => {
        it('should update prices for all goods from Sylius', async () => {
            await service.updateAllPrices();

            expect(mockSyliusProductService.getGoodIds).toHaveBeenCalled();
            expect(mockGoodService.updatePriceForService).toHaveBeenCalledWith(service, ['SKU1']);
        });

        it('should handle pagination and collect errors', async () => {
            mockSyliusProductService.getGoodIds
                .mockResolvedValueOnce({ goods: new Map([['SKU1', 1]]), nextArgs: { page: 2 } })
                .mockResolvedValueOnce({ goods: new Map([['SKU2', 1]]), nextArgs: null });
            mockGoodService.updatePriceForService
                .mockResolvedValueOnce([{ offer_id: 'SKU1', error: 'e1' }])
                .mockResolvedValueOnce(null);

            const result = await service.updateAllPrices();

            expect(mockSyliusProductService.getGoodIds).toHaveBeenCalledTimes(2);
            expect(mockGoodService.updatePriceForService).toHaveBeenCalledTimes(2);
            expect(result).toEqual([{ offer_id: 'SKU1', error: 'e1' }]);
        });
    });
});
