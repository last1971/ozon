import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { GoodsStatsGoodsDto } from '../yandex.offer/dto/goods.stats.goods.dto';
import { GoodsStatsTariffType } from '../yandex.offer/dto/goods.stats.tariff.dto';

export class YandexProductCoeffsAdapter implements IProductCoeffsable {
    constructor(private dto: GoodsStatsGoodsDto) {}
    getSalesPercent(): number {
        return this.dto.tariffs.find((t) => t.type === GoodsStatsTariffType.FEE).percent;
    }

    getSku(): string {
        return this.dto.shopSku;
    }

    getTransMaxAmount(): number {
        if (!this.dto.weightDimensions) return 45;
        const weight = Math.max(
            this.dto.weightDimensions.weight,
            (this.dto.weightDimensions.length * this.dto.weightDimensions.height * this.dto.weightDimensions.width) /
                5000,
        );
        if (weight < 0.2) {
            return 80;
        }
        if (weight < 0.5) {
            return 85;
        }
        if (weight < 1) {
            return 95;
        }
        if (weight < 2) {
            return 135;
        }
        if (weight < 4) {
            return 190;
        }
        if (weight < 6) {
            return 270;
        }
        if (weight < 8) {
            return 360;
        }
        if (weight < 10) {
            return 440;
        }
        if (weight < 12) {
            return 530;
        }
        if (weight < 15) {
            return 640;
        }
        if (weight < 20) {
            return 800;
        }
        return 1000;
    }
}
