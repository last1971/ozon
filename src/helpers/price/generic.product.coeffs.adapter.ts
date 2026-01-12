import { IProductCoeffsable } from '../../interfaces/i.product.coeffsable';

export class GenericProductCoeffsAdapter implements IProductCoeffsable {
    constructor(private sku: string) {}

    getSalesPercent(): number {
        return 0;
    }

    getSku(): string {
        return this.sku;
    }

    getTransMaxAmount(): number {
        return 0;
    }
}
