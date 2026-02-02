import { ProductInfoDto } from 'src/product/dto/product.info.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { ProductPriceDto } from './dto/product.price.dto';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';

export class OzonProductCoeffsAdapter implements IProductCoeffsable {
    private warehouse: 'fbo' | 'fbs';

    constructor(
        private product: ProductPriceDto,
        private percDirectFlow: number = 1,
        private productInfo: ProductInfoDto = null,
        private priceCalculationHelper: PriceCalculationHelper = null,
    ) {
        this.warehouse = this.priceCalculationHelper
            ? this.priceCalculationHelper.selectWarehouse(
                  productInfo?.fboCount || 0,
                  productInfo?.fbsCount || 0,
                  product.commissions.sales_percent_fbo,
                  product.commissions.sales_percent_fbs,
              )
            : (productInfo?.fboCount > productInfo?.fbsCount ? 'fbo' : 'fbs');
    }

    getSalesPercent(): number {
        if (this.priceCalculationHelper) {
            return this.priceCalculationHelper.getCommission(this.product.commissions, this.warehouse);
        }
        return this.warehouse === 'fbo'
            ? this.product.commissions.sales_percent_fbo
            : this.product.commissions.sales_percent_fbs;
    }

    getSku(): string {
        return this.product.offer_id;
    }

    getTransMaxAmount(): number {
        if (this.priceCalculationHelper) {
            return this.priceCalculationHelper.calculateDelivery(
                this.product.commissions,
                this.warehouse,
                this.percDirectFlow,
            );
        }
        const max = this.warehouse === 'fbo'
            ? this.product.commissions.fbo_direct_flow_trans_max_amount
            : this.product.commissions.fbs_direct_flow_trans_max_amount;
        const min = this.warehouse === 'fbo'
            ? this.product.commissions.fbo_direct_flow_trans_min_amount
            : this.product.commissions.fbs_direct_flow_trans_min_amount;
        return (max + min) / 2 * this.percDirectFlow;
    }
}
