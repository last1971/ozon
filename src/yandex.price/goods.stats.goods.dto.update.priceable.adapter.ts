import { GoodsStatsGoodsDto } from '../yandex.offer/dto/goods.stats.goods.dto';
import { IUpdatePriceable } from '../interfaces/IUpdatePriceable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { calculatePrice } from '../helpers';
import { GoodsStatsTariffType } from '../yandex.offer/dto/goods.stats.tariff.dto';
import { PercentsDto } from '../helpers/percents.dto';
import { GoodsWithPercents } from '../good/goods.with.percents';

export class GoodsStatsGoodsDtoUpdatePriceableAdapter implements IUpdatePriceable {
    private fbs_direct_flow_trans_max_amount: number;
    constructor(private good: GoodsStatsGoodsDto, private percents: PercentsDto) {
        this.fbs_direct_flow_trans_max_amount = this.calculateTransMaxAmount(good);
    }
    private calculateTransMaxAmount(dto: GoodsStatsGoodsDto): number {
        const weight = Math.max(
            dto.weightDimensions.weight,
            (dto.weightDimensions.length * dto.weightDimensions.height * dto.weightDimensions.width) / 5000,
        );
        if (weight < 0.2) {
            return 15;
        }
        if (weight < 0.5) {
            return 25;
        }
        if (weight < 1) {
            return 35;
        }
        if (weight < 2) {
            return 45;
        }
        if (weight < 4) {
            return 70;
        }
        if (weight < 6) {
            return 100;
        }
        if (weight < 8) {
            return 150;
        }
        if (weight < 10) {
            return 200;
        }
        if (weight < 12) {
            return 280;
        }
        if (weight < 15) {
            return 350;
        }
        return 400;
    }

    make(goodsWithPercents: GoodsWithPercents): UpdatePriceDto {
        const { incoming_price, min_perc, perc, old_perc, adv_perc } = goodsWithPercents.getPriceWithPercents(
            this.good.shopSku,
        );
        if (incoming_price === 0) return null;
        const sales_percent = this.good.tariffs.find((t) => t.type === GoodsStatsTariffType.FEE).percent;
        return calculatePrice(
            {
                offer_id: this.good.shopSku,
                incoming_price,
                fbs_direct_flow_trans_max_amount: this.fbs_direct_flow_trans_max_amount,
                sales_percent,
                min_perc,
                perc,
                old_perc,
                adv_perc,
            },
            this.percents,
        );
    }
}
