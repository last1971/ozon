import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';
import { ProductPriceDto } from './dto/product.price.dto';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';

describe('OzonProductCoeffsAdapter', () => {
    const mockProduct: ProductPriceDto = {
        offer_id: 'test-offer',
        commissions: {
            sales_percent_fbs: 33,
            sales_percent_fbo: 25,
            fbs_direct_flow_trans_max_amount: 100,
            fbs_direct_flow_trans_min_amount: 50,
            fbo_direct_flow_trans_max_amount: 80,
            fbo_direct_flow_trans_min_amount: 40,
        }
    } as ProductPriceDto;

    describe('without priceCalculationHelper', () => {
        it('should fallback to fbs when productInfo is null', () => {
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, null, null);
            expect(adapter.getSalesPercent()).toBe(33);
        });

        it('should select fbo when fboCount > fbsCount', () => {
            const productInfo = { fboCount: 80, fbsCount: 20 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, productInfo, null);
            expect(adapter.getSalesPercent()).toBe(25);
        });

        it('should select fbs when fbsCount > fboCount', () => {
            const productInfo = { fboCount: 20, fbsCount: 80 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, productInfo, null);
            expect(adapter.getSalesPercent()).toBe(33);
        });
    });

    describe('with priceCalculationHelper', () => {
        let mockHelper: Partial<PriceCalculationHelper>;

        beforeEach(() => {
            mockHelper = {
                selectWarehouse: jest.fn().mockReturnValue('fbo'),
                getCommission: jest.fn().mockReturnValue(25),
                calculateDelivery: jest.fn().mockReturnValue(60),
            };
        });

        it('should use helper for warehouse selection', () => {
            const productInfo = { fboCount: 80, fbsCount: 20 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, productInfo, mockHelper as PriceCalculationHelper);

            expect(mockHelper.selectWarehouse).toHaveBeenCalledWith(80, 20, 25, 33);
        });

        it('should use helper for getSalesPercent', () => {
            const productInfo = { fboCount: 80, fbsCount: 20 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, productInfo, mockHelper as PriceCalculationHelper);

            const result = adapter.getSalesPercent();
            expect(mockHelper.getCommission).toHaveBeenCalledWith(mockProduct.commissions, 'fbo');
            expect(result).toBe(25);
        });

        it('should use helper for getTransMaxAmount', () => {
            const productInfo = { fboCount: 80, fbsCount: 20 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1.1, productInfo, mockHelper as PriceCalculationHelper);

            const result = adapter.getTransMaxAmount();
            expect(mockHelper.calculateDelivery).toHaveBeenCalledWith(mockProduct.commissions, 'fbo', 1.1);
            expect(result).toBe(60);
        });
    });

    describe('getSku', () => {
        it('should return offer_id', () => {
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, null, null);
            expect(adapter.getSku()).toBe('test-offer');
        });
    });

    describe('getTransMaxAmount without helper', () => {
        it('should calculate fbs delivery when warehouse is fbs', () => {
            const productInfo = { fboCount: 20, fbsCount: 80 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, productInfo, null);
            // (100 + 50) / 2 = 75
            expect(adapter.getTransMaxAmount()).toBe(75);
        });

        it('should calculate fbo delivery when warehouse is fbo', () => {
            const productInfo = { fboCount: 80, fbsCount: 20 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1, productInfo, null);
            // (80 + 40) / 2 = 60
            expect(adapter.getTransMaxAmount()).toBe(60);
        });

        it('should apply percDirectFlow multiplier', () => {
            const productInfo = { fboCount: 20, fbsCount: 80 } as ProductInfoDto;
            const adapter = new OzonProductCoeffsAdapter(mockProduct, 1.1, productInfo, null);
            // 75 * 1.1 = 82.5
            expect(adapter.getTransMaxAmount()).toBe(82.5);
        });
    });
});
