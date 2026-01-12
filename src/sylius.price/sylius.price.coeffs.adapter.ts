import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';

export class SyliusPriceCoeffsAdapter implements IProductCoeffsable {
    constructor(
        private sku: string,
        private extPerc: number = 0,
    ) {}

    getSalesPercent(): number {
        return this.extPerc;
    }

    getSku(): string {
        return this.sku;
    }

    getTransMaxAmount(): number {
        return 0;
    }
}
