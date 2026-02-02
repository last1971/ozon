import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service';
import { ProductService } from '../product/product.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { ConfigService } from '@nestjs/config';
import { ProductVisibility } from '../product/product.visibility';
import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';
import { Cache } from "@nestjs/cache-manager";
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';

describe('PriceService', () => {
    let service: PriceService;
    const getPrices = jest.fn();
    const prices = jest.fn().mockResolvedValue([
        { code: 1, name: '1', price: 1 },
        { code: 2, name: '2', price: 2 },
        { code: 3, name: '3', price: 3 },
    ]);
    const getPerc = jest.fn().mockResolvedValue([]);
    const setPrice = jest.fn().mockResolvedValue({ result: [] });
    const updatePriceForService = jest.fn().mockResolvedValue({ result: [] });
    const mockPriceCalculationHelper = {
        provide: PriceCalculationHelper,
        useValue: {
            selectWarehouse: jest.fn(() => 'fbs'),
            getCommission: jest.fn((commissions, warehouse) => warehouse === 'fbo' ? commissions.sales_percent_fbo : commissions.sales_percent_fbs),
            calculateDelivery: jest.fn((commissions, warehouse, percDirectFlow) => (commissions.fbs_direct_flow_trans_max_amount + commissions.fbs_direct_flow_trans_min_amount) / 2 * percDirectFlow),
        },
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PriceService,
                { provide: ProductService, useValue: { getPrices, setPrice, skuList: ['sku1', 'sku2', 'sku3'] } },
                { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                { provide: Cache, useValue: { get: () => [], set: () => {}}},
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string) => {
                            switch (key) {
                                case 'PERC_MIN':
                                    return 1;
                                case 'PERC_NOR':
                                    return 2;
                                case 'PERC_MAX':
                                    return 3;
                                case 'PERC_MIL':
                                    return 5.5;
                                case 'PERC_EKV':
                                    return 1.5;
                                case 'SUM_OBTAIN':
                                    return 25;
                                case 'SUM_PACK':
                                    return 13;
                                case 'TAX_UNIT':
                                    return 6;
                                default:
                                    return null;
                            }
                        },
                    },
                },
                mockPriceCalculationHelper,
            ],
        }).compile();

        getPrices.mockClear();
        prices.mockClear();
        getPerc.mockClear();
        setPrice.mockClear();
        service = module.get<PriceService>(PriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('должен вернуть массив предложений с низкой прибылью', async () => {
        // Мокаем метод index с обязательными свойствами
        jest.spyOn(service, 'index').mockResolvedValue({
            data: [
                {
                    offer_id: "offer1",
                    marketing_price: 100,
                    incoming_price: 10,
                    available_price: 90,
                    product_id: 1,
                    name: "Product 1",
                    marketing_seller_price: 95,
                    min_price: 85,
                    price: 100,
                    old_price: 105,
                    min_perc: 5,
                    perc: 10,
                    old_perc: 12,
                    adv_perc: 0,
                    sales_percent: 8,
                    fbs_direct_flow_trans_max_amount: 50,
                    auto_action_enabled: false,
                    sum_pack: 0,
                    fbsCount: 1,
                    fboCount: 2,
                },
                {
                    offer_id: "offer2",
                    marketing_price: 200,
                    incoming_price: 10,
                    available_price: 0,
                    product_id: 2,
                    name: "Product 2",
                    marketing_seller_price: 205,
                    min_price: 190,
                    price: 220,
                    old_price: 230,
                    min_perc: 7,
                    perc: 0,
                    old_perc: 10,
                    adv_perc: 2,
                    sales_percent: 5,
                    fbs_direct_flow_trans_max_amount: 20,
                    auto_action_enabled: true,
                    sum_pack: 0,
                    fbsCount: 2,
                    fboCount: 1,
                },
                {
                    offer_id: "offer3",
                    marketing_price: 50,
                    incoming_price: 60,
                    available_price: 0,
                    product_id: 3,
                    name: "Product 3",
                    marketing_seller_price: 45,
                    min_price: 40,
                    price: 55,
                    old_price: 60,
                    min_perc: 3,
                    perc: 2,
                    old_perc: 3,
                    adv_perc: 1,
                    sales_percent: 0,
                    fbs_direct_flow_trans_max_amount: 10,
                    auto_action_enabled: false,
                    sum_pack: 0,
                    fbsCount: 0,
                    fboCount: 0,
                },
            ],
            last_id: '3',
        });

        const lowPrices = await service.getLowPrices(20, 10, 2); // minProfit = 20, minPercent = 10, max count = 2

        // Проверяем корректность результатов
        expect(lowPrices).toEqual(['offer1', 'offer3']);
        expect(lowPrices.length).toBe(2); // Ожидаемый результат ограничивается до 2 предложений
    });

    it('test preset', async () => {
        await expect(service.preset()).resolves.toEqual({
            min_mil: 0,
            perc_min: 1,
            perc_nor: 2,
            perc_max: 3,
            perc_mil: 5.5,
            perc_ekv: 1.5,
            sum_obtain: 25,
            sum_pack: 13,
            tax_unit: 6,
            sum_label: 0,
        });
    });

    it('test index', async () => {
        getPrices.mockResolvedValueOnce({
            items: [
                {
                    offer_id: '1',
                    price: {},
                    commissions: { sales_percent_fbs: 1, fbs_direct_flow_trans_max_amount: 2 },
                },
                {
                    offer_id: '2',
                    price: {},
                    commissions: { sales_percent_fbs: 1, fbs_direct_flow_trans_max_amount: 2 },
                },
                {
                    offer_id: '3',
                    price: {},
                    commissions: { sales_percent_fbs: 1, fbs_direct_flow_trans_max_amount: 2 },
                },
            ],
        });
        await service.index({ limit: 0, visibility: ProductVisibility.VISIBLE });
        expect(getPrices.mock.calls[0]).toEqual([{ limit: 0, visibility: 'VISIBLE' }]);
        expect(prices.mock.calls[0]).toEqual([['1', '2', '3'], null]);
        expect(getPerc.mock.calls[0]).toEqual([['1', '2', '3'], null]);
    });

    it('test update', async () => {
        await service.update({ prices: [] });
        expect(setPrice.mock.calls[0]).toEqual([{ prices: [] }]);
    });
    it('Test updatePrices', async () => {
        getPrices
            .mockResolvedValueOnce({
                items: [
                    {
                        offer_id: '1',
                        price: {},
                        commissions: { sales_percent_fbs: 1, fbs_direct_flow_trans_max_amount: 2 },
                    },
                    {
                        offer_id: '2',
                        price: {},
                        commissions: { sales_percent_fbs: 1, fbs_direct_flow_trans_max_amount: 2 },
                    },
                    {
                        offer_id: '3',
                        price: {},
                        commissions: { sales_percent_fbs: 1, fbs_direct_flow_trans_max_amount: 2 },
                    },
                ],
            })
            .mockResolvedValueOnce({ items: [] });
        await service.updateAllPrices();
        expect(getPrices.mock.calls).toHaveLength(2);
        expect(getPrices.mock.calls[0]).toEqual([{ cursor: '', limit: 1000, visibility: 'IN_SALE' }]);
        expect(updatePriceForService.mock.calls).toHaveLength(1);
    });
    it('getObtainCoeffs', () => {
        expect(service.getObtainCoeffs()).toEqual({
            minMil: null,
            percEkv: 1.5,
            percMil: 5.5,
            sumLabel: 0,
            sumObtain: 25,
            taxUnit: 6,
        });
    });
    it('getProductsWithCoeffs', async () => {
        getPrices.mockResolvedValueOnce({
            items: [
                {
                    offer_id: '1',
                    price: {},
                    commissions: { 
                        sales_percent_fbs: 1, 
                        sales_percent_fbo: 2,
                        fbs_direct_flow_trans_max_amount: 2 
                    },
                },
            ],
        });

        const mockInfoList = jest.fn().mockResolvedValueOnce([{
            sku: '1',
            fbsCount: 5,
            fboCount: 3
        }]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PriceService,
                { 
                    provide: ProductService, 
                    useValue: { 
                        getPrices, 
                        setPrice, 
                        skuList: ['sku1', 'sku2', 'sku3'],
                        infoList: mockInfoList
                    } 
                },
                { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                { provide: Cache, useValue: { get: () => [], set: () => {}}},
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string) => {
                            switch (key) {
                                case 'PERC_MIN':
                                    return 1;
                                case 'PERC_NOR':
                                    return 2;
                                case 'PERC_MAX':
                                    return 3;
                                case 'PERC_MIL':
                                    return 5.5;
                                case 'PERC_EKV':
                                    return 1.5;
                                case 'SUM_OBTAIN':
                                    return 25;
                                case 'SUM_PACK':
                                    return 13;
                                case 'TAX_UNIT':
                                    return 6;
                                default:
                                    return null;
                            }
                        },
                    },
                },
                mockPriceCalculationHelper,
            ],
        }).compile();

        service = module.get<PriceService>(PriceService);
        const res = await service.getProductsWithCoeffs(['1']);
        expect(res[0]).toBeInstanceOf(OzonProductCoeffsAdapter);
        expect(getPrices.mock.calls[0]).toEqual([{ limit: 1000, offer_id: ['1'], visibility: 'IN_SALE' }]);
        expect(mockInfoList).toHaveBeenCalledWith(['1']);
    });

    it('checkVatForAll collects mismatches across pages', async () => {
        // page 1
        getPrices
          .mockResolvedValueOnce({
            items: [
              { offer_id: 'A', price: { vat: '0.2' } }, // ok (20% = '0.2')
              { offer_id: 'B', price: { vat: '0.1' } }, // mismatch (10% = '0.1')
            ],
            cursor: 'next',
          })
          // page 2
          .mockResolvedValueOnce({
            items: [{ offer_id: 'C', price: { vat: '0' } }], // mismatch (0% = '0')
            cursor: '',
          });

        const expectedVat = 20; // ожидаем 20%
        const res = await service.checkVatForAll(expectedVat, 1000);

        expect(res).toEqual([
          { offer_id: 'B', current_vat: 10, expected_vat: 20 },
          { offer_id: 'C', current_vat: 0, expected_vat: 20 },
        ]);

        // called twice with visibility ALL and correct cursors
        expect(getPrices.mock.calls[0]).toEqual([{ limit: 1000, cursor: '', visibility: 'ALL' }]);
        expect(getPrices.mock.calls[1]).toEqual([{ limit: 1000, cursor: 'next', visibility: 'ALL' }]);
      });

    it('updateVat should call update with correct prices structure', async () => {
        const offerIds = ['SKU123', 'SKU456', 'SKU789'];
        const vat = 20; // 20%

        await service.updateVat(offerIds, vat);

        expect(setPrice).toHaveBeenCalledWith({
            prices: [
                { offer_id: 'SKU123', vat: '0.2', currency_code: 'RUB' },
                { offer_id: 'SKU456', vat: '0.2', currency_code: 'RUB' },
                { offer_id: 'SKU789', vat: '0.2', currency_code: 'RUB' },
            ]
        });
    });

    it('updateVat should handle empty offer ids array', async () => {
        await service.updateVat([], 0);

        expect(setPrice).toHaveBeenCalledWith({
            prices: []
        });
    });

    describe('getOzonPrices', () => {
        it('should return PriceDto array for given SKUs', async () => {
            const mockPriceData = [
                {
                    offer_id: 'sku1',
                    product_id: 1,
                    name: 'Product 1',
                    marketing_price: 100,
                    incoming_price: 50,
                    marketing_seller_price: 95,
                    min_price: 80,
                    price: 100,
                    old_price: 120,
                },
                {
                    offer_id: 'sku2',
                    product_id: 2,
                    name: 'Product 2',
                    marketing_price: 200,
                    incoming_price: 100,
                    marketing_seller_price: 190,
                    min_price: 150,
                    price: 200,
                    old_price: 250,
                },
            ];

            jest.spyOn(service, 'index').mockResolvedValue({
                data: mockPriceData as any,
                last_id: '2',
            });

            const result = await service.getOzonPrices(['sku1', 'sku2']);

            expect(result).toEqual(mockPriceData);
            expect(service.index).toHaveBeenCalledWith({
                offer_id: ['sku1', 'sku2'],
                limit: 2,
                visibility: ProductVisibility.IN_SALE,
            });
        });

        it('should handle batching for large SKU lists', async () => {
            const skus = Array.from({ length: 1500 }, (_, i) => `sku${i}`);
            const batch1 = skus.slice(0, 1000);
            const batch2 = skus.slice(1000);

            const mockData1 = batch1.map((sku) => ({ offer_id: sku }));
            const mockData2 = batch2.map((sku) => ({ offer_id: sku }));

            jest.spyOn(service, 'index')
                .mockResolvedValueOnce({ data: mockData1 as any, last_id: '999' })
                .mockResolvedValueOnce({ data: mockData2 as any, last_id: '1499' });

            const result = await service.getOzonPrices(skus);

            expect(result.length).toBe(1500);
            expect(service.index).toHaveBeenCalledTimes(2);
        });

        it('should return empty array for empty SKUs', async () => {
            const result = await service.getOzonPrices([]);

            expect(result).toEqual([]);
        });
    });

    describe('index with volumeWeight', () => {
        it('should include volumeWeight from productInfo', async () => {
            const mockInfoList = jest.fn().mockResolvedValueOnce([
                { sku: 'sku1', fbsCount: 5, fboCount: 3, typeId: 123, volumeWeight: 0.5 },
            ]);

            const mockPrices = jest.fn().mockResolvedValueOnce([
                { code: 'sku1', name: 'Product 1', price: 100 },
            ]);

            const mockGetPerc = jest.fn().mockResolvedValueOnce([]);

            getPrices.mockResolvedValueOnce({
                items: [
                    {
                        offer_id: 'sku1',
                        price: { marketing_price: '100', min_price: '80' },
                        commissions: { sales_percent_fbs: 10, fbs_direct_flow_trans_max_amount: 20 },
                    },
                ],
            });

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    {
                        provide: ProductService,
                        useValue: {
                            getPrices,
                            setPrice,
                            skuList: ['sku1'],
                            infoList: mockInfoList,
                        },
                    },
                    { provide: GOOD_SERVICE, useValue: { prices: mockPrices, getPerc: mockGetPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: () => [], set: () => {} } },
                    {
                        provide: ConfigService,
                        useValue: { get: () => null },
                    },
                    mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.index({
                offer_id: ['sku1'],
                limit: 1,
                visibility: ProductVisibility.IN_SALE,
            });

            expect(result.data[0].volumeWeight).toBe(0.5);
            expect(mockInfoList).toHaveBeenCalledWith(['sku1']);
        });
    });

    describe('getCommission', () => {
        it('should return commission from cache', async () => {
            const mockCacheGet = jest.fn().mockResolvedValue('{"fbs":0.2,"fbo":0.15}');
            const mockCacheSet = jest.fn();

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [] } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: mockCacheSet } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.getCommission('12345');

            expect(result).toEqual({ fbs: 0.2, fbo: 0.15 });
            expect(mockCacheGet).toHaveBeenCalledWith('ozon:commission:12345');
        });

        it('should return null if not in cache', async () => {
            const mockCacheGet = jest.fn().mockResolvedValue(null);

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [] } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: jest.fn() } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.getCommission('99999');

            expect(result).toBeNull();
        });
    });

    describe('getTypeId', () => {
        it('should return cached typeId', async () => {
            const mockCacheGet = jest.fn().mockResolvedValue('12345');

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [], infoList: jest.fn() } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: jest.fn() } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.getTypeId('sku1');

            expect(result).toBe('12345');
            expect(mockCacheGet).toHaveBeenCalledWith('ozon:type_id:sku1');
        });

        it('should fetch and cache typeId if not cached', async () => {
            const mockCacheGet = jest.fn().mockResolvedValue(null);
            const mockCacheSet = jest.fn();
            const mockInfoList = jest.fn().mockResolvedValue([{ sku: 'sku1', typeId: 67890 }]);

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [], infoList: mockInfoList } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: mockCacheSet } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.getTypeId('sku1');

            expect(result).toBe('67890');
            expect(mockInfoList).toHaveBeenCalledWith(['sku1']);
            expect(mockCacheSet).toHaveBeenCalledWith('ozon:type_id:sku1', '67890');
        });

        it('should return null if product not found', async () => {
            const mockCacheGet = jest.fn().mockResolvedValue(null);
            const mockInfoList = jest.fn().mockResolvedValue([]);

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [], infoList: mockInfoList } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: jest.fn() } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.getTypeId('unknown');

            expect(result).toBeNull();
        });
    });

    describe('optimizeOzonPrice', () => {
        const basePrice = {
            offer_id: 'sku1',
            incoming_price: 100,
            available_price: 0,
            sales_percent: 38,
            fbs_direct_flow_trans_max_amount: 17,
            sum_pack: 10,
            adv_perc: 0,
            min_perc: 20,
            perc: 30,
            old_perc: 50,
        };

        const percents = {
            percMil: 5,
            percEkv: 1.5,
            sumObtain: 25,
            taxUnit: 6,
            minMil: 0,
            sumLabel: 0,
        };

        it('should return original price if incoming_price >= 150', async () => {
            const mockCacheGet = jest.fn();

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [] } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: jest.fn() } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const expensivePrice = { ...basePrice, incoming_price: 200 };
            const result = await testService.optimizeOzonPrice(expensivePrice, percents, '123');

            expect(mockCacheGet).not.toHaveBeenCalled();
            expect(result.offer_id).toBe('sku1');
        });

        it('should return original price if no commission in cache', async () => {
            const mockCacheGet = jest.fn().mockResolvedValue(null);

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [] } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: jest.fn() } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.optimizeOzonPrice(basePrice, percents, '123');

            expect(result.offer_id).toBe('sku1');
        });

        it('should optimize price when commission found and profitable', async () => {
            const mockCacheGet = jest.fn().mockResolvedValue('{"fbs":0.2,"fbo":0.15}');

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    { provide: ProductService, useValue: { getPrices, setPrice, skuList: [] } },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: mockCacheGet, set: jest.fn() } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);
            const result = await testService.optimizeOzonPrice(basePrice, percents, '123');

            expect(result).toBeDefined();
            expect(result.offer_id).toBe('sku1');
        });
    });

    describe('loadCommissionsFromXlsx', () => {
        it('should load commissions from xlsx and save to cache', async () => {
            const mockCacheSet = jest.fn();
            const mockGetCategoryTree = jest.fn().mockResolvedValue({
                result: [
                    {
                        type_id: 123,
                        type_name: 'Test Category',
                        children: [],
                    },
                ],
            });

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    PriceService,
                    {
                        provide: ProductService,
                        useValue: {
                            getPrices,
                            setPrice,
                            skuList: [],
                            getCategoryTree: mockGetCategoryTree,
                        },
                    },
                    { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
                    { provide: Cache, useValue: { get: jest.fn(), set: mockCacheSet } },
                    { provide: ConfigService, useValue: { get: () => null } },
                mockPriceCalculationHelper,
                ],
            }).compile();

            const testService = module.get<PriceService>(PriceService);

            // Create minimal xlsx buffer with test data
            const Excel = require('exceljs');
            const workbook = new Excel.Workbook();
            const sheet = workbook.addWorksheet('Commissions');
            sheet.addRow(['Category', 'Type', 'Col3', 'FBO', 'Col5', 'Col6', 'Col7', 'Col8', 'Col9', 'FBS']);
            sheet.addRow(['Cat1', 'Test Category', '', 0.15, '', '', '', '', '', 0.2]);
            const buffer = await workbook.xlsx.writeBuffer();

            const result = await testService.loadCommissionsFromXlsx(buffer);

            expect(result.loaded).toBeGreaterThanOrEqual(0);
            expect(mockGetCategoryTree).toHaveBeenCalled();
        });
    });
});
