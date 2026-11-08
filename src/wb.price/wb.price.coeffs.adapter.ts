import type { LossPricingStatistics } from '../marketplace-loss/loss-pricing.service';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { GoodWbDto } from '../good/dto/good.wb.dto';

export class WbPriceCoeffsAdapter implements IProductCoeffsable {
    constructor(
        private goodWbDto: GoodWbDto,
        private wbExtPerc: number,
        private readonly losses?: LossPricingStatistics,
        private readonly marketplaceStock = 0,
    ) {}

    getMarketplaceStock() { return this.marketplaceStock; }

    getLossStatistics() {
        if (this.losses && this.losses.paidReturnDelivery === undefined)
            return { ...this.losses, paidReturnDelivery: null }; // Собственный проверенный расход ВБ обязателен.
        return this.losses;
    }

    getSalesPercent(): number {
        return this.goodWbDto.commission + this.wbExtPerc;
    }

    getSku(): string {
        return this.goodWbDto.id;
    }

    getTransMaxAmount(): number {
        return this.goodWbDto.tariff;
    }
}
