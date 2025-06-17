import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';
import { ProductPriceDto } from './dto/product.price.dto';
import { ProductInfoDto } from '../product/dto/product.info.dto';

describe('OzonProductCoeffsAdapter', () => {
    describe('calculateSalesPercent', () => {
        const mockProduct: ProductPriceDto = {
            offer_id: 'test-offer',
            commissions: {
                sales_percent_fbs: 5,
                sales_percent_fbo: 3,
                fbs_direct_flow_trans_max_amount: 100,
                fbs_direct_flow_trans_min_amount: 50
            }
        } as ProductPriceDto;

        it('should return fbs percent when productInfo is null', () => {
            const result = OzonProductCoeffsAdapter.calculateSalesPercent(mockProduct);
            expect(result).toBe(mockProduct.commissions.sales_percent_fbs);
        });

        it('should return fbs percent when fbsCount is greater than fboCount', () => {
            const productInfo: ProductInfoDto = {
                sku: 'test-offer',
                fbsCount: 10,
                fboCount: 5
            } as ProductInfoDto;

            const result = OzonProductCoeffsAdapter.calculateSalesPercent(mockProduct, productInfo);
            expect(result).toBe(mockProduct.commissions.sales_percent_fbs);
        });

        it('should return fbo percent when fboCount is greater than fbsCount', () => {
            const productInfo: ProductInfoDto = {
                sku: 'test-offer',
                fbsCount: 5,
                fboCount: 10
            } as ProductInfoDto;

            const result = OzonProductCoeffsAdapter.calculateSalesPercent(mockProduct, productInfo);
            expect(result).toBe(mockProduct.commissions.sales_percent_fbo);
        });

        it('should return fbs percent when fbsCount equals fboCount', () => {
            const productInfo: ProductInfoDto = {
                sku: 'test-offer',
                fbsCount: 10,
                fboCount: 10
            } as ProductInfoDto;

            const result = OzonProductCoeffsAdapter.calculateSalesPercent(mockProduct, productInfo);
            expect(result).toBe(mockProduct.commissions.sales_percent_fbs);
        });
    });
}); 