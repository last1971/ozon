import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { ProductPriceDto } from './dto/product.price.dto';

export class OzonProductCoeffsAdapter implements IProductCoeffsable {
    constructor(private product: ProductPriceDto, private percDirectFlow: number = 1) {}

    getSalesPercent(): number {
        return this.product.commissions.sales_percent_fbs;
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
}
