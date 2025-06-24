import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PriceCalculationHelper } from './price.calculation.helper';
import { IPriceUpdateable } from '../../interfaces/i.price.updateable';
import { IGood } from '../../interfaces/IGood';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { IProductCoeffsable } from '../../interfaces/i.product.coeffsable';
import { GoodPriceDto } from '../../good/dto/good.price.dto';
import { IPriceable } from "../../interfaces/i.priceable";
import * as helpers from '../price/price.helpers';

describe("PriceCalculationHelper", () => {
    let helper: PriceCalculationHelper;
    let configService: ConfigService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PriceCalculationHelper,
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key, defaultValue) => {
                            const config = {
                                "PERC_MAX": 80,
                                "PERC_NOR": 40,
                                "PERC_MIN": 20,
                                "SUM_PACK": 10,
                                "MIN_PROFIT_PERC": 10,
                                "MIN_PROFIT_TARGET": 103,
                                "PRICE_SMOOTHING_OFFSET": 500,
                                "MIN_PROFIT_RUB": 10,
                            };
                            return config[key] || defaultValue;
                        })
                    }
                }
            ]
        }).compile();

        helper = module.get<PriceCalculationHelper>(PriceCalculationHelper);
        configService = module.get<ConfigService>(ConfigService);
    });

    describe("preparePricesContext", () => {
        it("should prepare prices context correctly", async () => {
            // Mock data
            const skus = ["SKU1", "SKU2"];
            const mockGoods = [
                { code: "1", price: 100, name: "Product 1" },
                { code: "2", price: 200, name: "Product 2" }
            ];
            const mockPercents = [
                { offer_id: "1", pieces: 1, perc: 40 },
                { offer_id: "2", pieces: 1, perc: 40 }
            ];
            const mockProducts = [
                { getSku: () => "SKU1" },
                { getSku: () => "SKU2" }
            ];

            // Mock services
            const mockService: IPriceUpdateable = {
                getProductsWithCoeffs: jest.fn().mockResolvedValue(mockProducts),
                getObtainCoeffs: jest.fn().mockReturnValue({
                    minMil: 20,
                    percMil: 5.5,
                    percEkv: 1,
                    sumObtain: 25,
                    sumLabel: 10,
                    taxUnit: 6,
                }),
                updatePrices: jest.fn(),
                updateAllPrices: jest.fn(),
                createAction: jest.fn()
            };

            const mockGoodService: IGood = {
                prices: jest.fn().mockResolvedValue(mockGoods),
                getPerc: jest.fn().mockResolvedValue(mockPercents),
                in: jest.fn(),
                getQuantities: jest.fn(),
                setPercents: jest.fn(),
                setWbData: jest.fn(),
                getWbData: jest.fn(),
                updateCountForService: jest.fn(),
                updateCountForSkus: jest.fn(),
                updatePriceForService: jest.fn(),
                getWbCategoryByName: jest.fn(),
                updateWbCategory: jest.fn(),
                resetAvailablePrice: jest.fn(),
                updatePercentsForService:  jest.fn().mockResolvedValue(undefined),
                generatePercentsForService:  jest.fn().mockResolvedValue(undefined),
            };

            const result = await helper.preparePricesContext(
                mockService,
                skus,
                mockGoodService
            );

            expect(result).toEqual({
                codes: expect.any(Array),
                goods: mockGoods,
                percents: mockPercents,
                products: mockProducts
            });
            expect(mockService.getProductsWithCoeffs).toHaveBeenCalledWith(skus);
            expect(mockGoodService.prices).toHaveBeenCalled();
            expect(mockGoodService.getPerc).toHaveBeenCalled();
        });
    });

    describe('getIncomingPrice', () => {
        it('should return price from prices map if available', () => {
            const product: IProductCoeffsable = {
                getSku: () => '1234-2',
                getTransMaxAmount: () => 40,
                getSalesPercent: () => 10
            };
            const goods: GoodPriceDto[] = [
                { code: 1234, price: 100, name: 'Test Product' }
            ];
            const prices = new Map<string, UpdatePriceDto>();
            prices.set('1234-2', { incoming_price: 150 } as UpdatePriceDto);

            const result = helper.getIncomingPrice(product, goods, prices);
            expect(result).toBe(150);
        });

        it('should calculate price from goods if not in prices map', () => {
            const product: IProductCoeffsable = {
                getSku: () => '1234-2',
                getTransMaxAmount: () => 40,
                getSalesPercent: () => 10
            };
            const goods: GoodPriceDto[] = [
                { code: 1234, price: 100, name: 'Test Product' }
            ];

            const result = helper.getIncomingPrice(product, goods);
            expect(result).toBe(200); // 100 * 2
        });
    });

    it('should return correct initial percents for default (no incoming_price)', () => {
        const result = helper.getInitialPercents();
        expect(result).toEqual({
            old_perc: 80,  // PERC_MAX
            perc: 40,      // PERC_NOR
            min_perc: 20   // PERC_MIN
        });
    });

    it('should return correct initial percents for incoming_price', () => {
        const result = helper.getInitialPercents(1000);
        // base = MIN_PROFIT_PERC + MIN_PROFIT_TARGET / (incoming_price + PRICE_SMOOTHING_OFFSET) * 100
        // base = 10 + 103 / (1000 + 500) * 100 ≈ 10 + 6.8666... ≈ 16.8666...
        // old_perc = Math.round(16.8666... * 4) ≈ 67
        // perc = Math.round(16.8666... * 2) ≈ 34
        // min_perc = Math.round(16.8666...) ≈ 17
        expect(result).toEqual({
            old_perc: 67,
            perc: 34,
            min_perc: 17
        });
    });

    describe('getDefaultPercents', () => {
        it('should return default percents with custom packing price', () => {
            const result = helper.getDefaultPercents(15);
            expect(result).toEqual({
                adv_perc: 0,
                old_perc: 80,
                perc: 40,
                min_perc: 20,
                packing_price: 15,
                available_price: 0,
                offer_id: '',
                pieces: 1
            });
        });

        it('should return default percents with default packing price', () => {
            const result = helper.getDefaultPercents();
            expect(result).toEqual({
                adv_perc: 0,
                old_perc: 80,
                perc: 40,
                min_perc: 20,
                packing_price: 10,
                available_price: 0,
                offer_id: '',
                pieces: 1
            });
        });
    });

    describe('adjustPercents', () => {
        let mockService: IPriceUpdateable;
        let initialPrice: IPriceable;

        beforeEach(() => {
            mockService = {
                getObtainCoeffs: jest.fn().mockReturnValue({
                    minMil: 20,
                    percMil: 5.5,
                    percEkv: 1,
                    sumObtain: 25,
                    sumLabel: 10,
                    taxUnit: 6
                }),
                getProductsWithCoeffs: jest.fn(),
                updatePrices: jest.fn(),
                updateAllPrices: jest.fn(),
                createAction: jest.fn()
            };

            initialPrice = {
                adv_perc: 1,
                fbs_direct_flow_trans_max_amount: 20,
                incoming_price: 100,
                available_price: 0,
                offer_id: 'TEST-1',
                sales_percent: 10,
                sum_pack: 10,
                min_perc: 20,
                perc: 40,
                old_perc: 80
            };
        });

        it('should adjust all percents when needed', () => {
            const result = helper.adjustPercents(initialPrice, mockService);

            expect(result.min_perc).toBeGreaterThanOrEqual(20);
            expect(result.perc).toBe(result.min_perc * 2);
            expect(result.old_perc).toBeGreaterThanOrEqual(result.perc);
        });
    });

    describe('calculatePriceWithPercents', () => {
        let mockService: IPriceUpdateable;

        beforeEach(() => {
            mockService = {
                getObtainCoeffs: jest.fn().mockReturnValue({
                    minMil: 20,
                    percMil: 5.5,
                    percEkv: 1,
                    sumObtain: 25,
                    sumLabel: 10,
                    taxUnit: 6
                }),
                getProductsWithCoeffs: jest.fn(),
                updatePrices: jest.fn(),
                updateAllPrices: jest.fn(),
                createAction: jest.fn()
            };
        });

        it('should calculate price with given percents', () => {
            const price: IPriceable = {
                adv_perc: 1,
                fbs_direct_flow_trans_max_amount: 20,
                incoming_price: 100,
                available_price: 0,
                offer_id: 'TEST-1',
                sales_percent: 10,
                sum_pack: 10,
                min_perc: 20,
                perc: 40,
                old_perc: 80
            };

            const result = (helper as any).calculatePriceWithPercents(
                price,
                mockService,
                20,
                40,
                80
            );

            expect(result).toBeDefined();
            expect(result.min_price).toBeDefined();
            expect(result.price).toBeDefined();
            expect(result.old_price).toBeDefined();
        });
    });

    describe('price adjustment conditions', () => {
        describe('shouldAdjustMinPrice', () => {
            let service: IPriceUpdateable;

            beforeEach(() => {
                service = {
                    getObtainCoeffs: jest.fn().mockReturnValue({
                        minMil: 20,
                        percMil: 5.5,
                        percEkv: 1,
                        sumObtain: 25,
                        sumLabel: 10,
                        taxUnit: 6,
                    }),
                    getProductsWithCoeffs: jest.fn(),
                    updatePrices: jest.fn(),
                    updateAllPrices: jest.fn(),
                    createAction: jest.fn()
                };
            });

            it('returns true if profit (using available_price) is less than threshold', () => {
                jest.spyOn(helpers, 'calculatePay').mockReturnValue(125); // profit = 125 - 120 = 5 < 11
                const price: UpdatePriceDto = { min_price: 100 } as any;
                const initialPrice: any = { available_price: 120, incoming_price: 80 };
                expect((helper as any).shouldAdjustMinPrice(price, initialPrice, service)).toBe(true);
            });

            it('returns true if profit (using incoming_price) is less than threshold', () => {
                jest.spyOn(helpers, 'calculatePay').mockReturnValue(85); // profit = 85 - 80 = 5 < 11
                const price: UpdatePriceDto = { min_price: 100 } as any;
                const initialPrice: any = { available_price: 0, incoming_price: 80 };
                expect((helper as any).shouldAdjustMinPrice(price, initialPrice, service)).toBe(true);
            });

            it('returns false if profit is greater than threshold', () => {
                jest.spyOn(helpers, 'calculatePay').mockReturnValue(200); // profit = 200 - 120 = 80 > 11
                const price: UpdatePriceDto = { min_price: 100 } as any;
                const initialPrice: any = { available_price: 120, incoming_price: 80 };
                expect((helper as any).shouldAdjustMinPrice(price, initialPrice, service)).toBe(false);
            });
        });

        describe('shouldAdjustNormalPrice', () => {
            it('should return true when difference between price and min_price is less than threshold', () => {
                const price = {
                    price: '30',
                    min_price: '15'
                } as UpdatePriceDto;
                expect((helper as any).shouldAdjustNormalPrice(price)).toBe(true);
            });

            it('should return false when difference is adequate', () => {
                const price = {
                    price: '40',
                    min_price: '15'
                } as UpdatePriceDto;
                expect((helper as any).shouldAdjustNormalPrice(price)).toBe(false);
            });
        });

        describe('shouldAdjustOldPrice', () => {
            it('should return true when difference between old_price and price is less than threshold*2', () => {
                const price = {
                    old_price: '50',
                    price: '30'
                } as UpdatePriceDto;
                expect((helper as any).shouldAdjustOldPrice(price)).toBe(true);
            });

            it('should return false when difference is adequate', () => {
                const price = {
                    old_price: '90',
                    price: '30'
                } as UpdatePriceDto;
                expect((helper as any).shouldAdjustOldPrice(price)).toBe(false);
            });
        });
    });
});
