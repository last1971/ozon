import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { GoodAvitoDto } from '../good/dto/good.avito.dto';
import { avitoSku } from '../avito.card/avito.sku';

export class AvitoPriceCoeffsAdapter implements IProductCoeffsable {
    constructor(
        private goodAvitoDto: GoodAvitoDto,
        private avitoExtPerc: number = 0,
    ) {}

    getSalesPercent(): number {
        return this.goodAvitoDto.commission + this.avitoExtPerc;
    }

    getSku(): string {
        return avitoSku(this.goodAvitoDto);
    }

    getTransMaxAmount(): number {
        // TODO: определить правильное значение для Avito
        // Возможно, это будет тариф доставки или лимит транзакции
        return 0;
    }
}