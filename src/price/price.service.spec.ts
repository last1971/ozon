import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service';
import { ProductService } from '../product/product.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { ConfigService } from '@nestjs/config';
import { ProductVisibility } from '../product/product.visibility';
import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';

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
                { provide: ProductService, useValue: { getPrices, setPrice } },
                { provide: GOOD_SERVICE, useValue: { prices, getPerc, updatePriceForService } },
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
        expect(getPrices.mock.calls[0]).toEqual([{ last_id: '', limit: 1000, visibility: 'IN_SALE' }]);
        expect(updatePriceForService.mock.calls).toHaveLength(1);
    });
    it('getObtainCoeffs', () => {
        expect(service.getObtainCoeffs()).toEqual({
            minMil: null,
            percEkv: 1.5,
            percMil: 5.5,
            sumLabel: 0,
            sumObtain: 25,
        });
    });
    it('getProductsWithCoeffs', async () => {
        getPrices.mockResolvedValueOnce({
            items: [
                {
                    offer_id: '1',
                    price: {},
                    commissions: { sales_percent_fbs: 1, fbs_direct_flow_trans_max_amount: 2 },
                },
            ],
        });
        const res = await service.getProductsWithCoeffs(['1']);
        expect(res[0]).toBeInstanceOf(OzonProductCoeffsAdapter);
        expect(getPrices.mock.calls[0]).toEqual([{ limit: 1000, offer_id: ['1'], visibility: 'IN_SALE' }]);
    });
});
