import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { GoodAvitoDto } from '../good/dto/good.avito.dto';

export class AvitoPriceCoeffsAdapter implements IProductCoeffsable {
    constructor(
        private goodAvitoDto: GoodAvitoDto,
        private avitoExtPerc: number = 0,
    ) {}

    getSalesPercent(): number {
        return this.goodAvitoDto.commission + this.avitoExtPerc;
    }

    getSku(): string {
        const { goodsCode, coeff } = this.goodAvitoDto;
        return coeff === 1 ? goodsCode : `${goodsCode}-${coeff}`;
    }

    getTransMaxAmount(): number {
        // TODO: определить правильное значение для Avito
        // Возможно, это будет тариф доставки или лимит транзакции
        return 0;
    }
}