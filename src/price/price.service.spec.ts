import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service';
import { ProductService } from '../product/product.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { ConfigService } from '@nestjs/config';
import { ProductVisibility } from '../product/product.visibility';
import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';
import { Cache } from "@nestjs/cache-manager";

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
              { offer_id: 'A', price: { vat: 20 } }, // ok
              { offer_id: 'B', price: { vat: 10 } }, // mismatch
            ],
            cursor: 'next',
          })
          // page 2
          .mockResolvedValueOnce({
            items: [{ offer_id: 'C', price: { vat: 0 } }], // mismatch
            cursor: '',
          });
      
        const expectedVat = 20;
        const res = await service.checkVatForAll(expectedVat, 1000);
      
        expect(res).toEqual([
          { offer_id: 'B', current_vat: 10, expected_vat: 20 },
          { offer_id: 'C', current_vat: 0, expected_vat: 20 },
        ]);
      
        // called twice with visibility ALL and correct cursors
        expect(getPrices.mock.calls[0]).toEqual([{ limit: 1000, cursor: '', visibility: 'ALL' }]);
        expect(getPrices.mock.calls[1]).toEqual([{ limit: 1000, cursor: 'next', visibility: 'ALL' }]);
      });
});
