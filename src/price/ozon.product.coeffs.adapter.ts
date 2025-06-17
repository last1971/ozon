import { ProductInfoDto } from 'src/product/dto/product.info.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { ProductPriceDto } from './dto/product.price.dto';

export class OzonProductCoeffsAdapter implements IProductCoeffsable {
    constructor(
        private product: ProductPriceDto, 
        private percDirectFlow: number = 1, 
        private productInfo: ProductInfoDto = null) {}

    getSalesPercent(): number {
        return OzonProductCoeffsAdapter.calculateSalesPercent(this.product, this.productInfo);
    }

    getSku(): string {
        return this.product.offer_id;
    }

    getTransMaxAmount(): number {
        return (
            this.product.commissions.fbs_direct_flow_trans_max_amount
            +
            this.product.commissions.fbs_direct_flow_trans_min_amount
        ) / 2 * this.percDirectFlow;
    }

    static calculateSalesPercent(product: ProductPriceDto, productInfo?: ProductInfoDto): number {
        if (!productInfo) {
            return product.commissions.sales_percent_fbs;
        }

        return productInfo.fboCount > productInfo.fbsCount
            ? product.commissions.sales_percent_fbo
            : product.commissions.sales_percent_fbs;
    }
}
