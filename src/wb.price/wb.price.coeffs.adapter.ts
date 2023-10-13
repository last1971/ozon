import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { GoodWbDto } from '../good/dto/good.wb.dto';

export class WbPriceCoeffsAdapter implements IProductCoeffsable {
    constructor(private goodWbDto: GoodWbDto) {}

    getSalesPercent(): number {
        return this.goodWbDto.commission;
    }

    getSku(): string {
        return this.goodWbDto.id;
    }

    getTransMaxAmount(): number {
        return this.goodWbDto.tariff;
    }
}
