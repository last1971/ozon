import { GoodPriceDto } from './dto/good.price.dto';
import { GoodPercentDto } from './dto/good.percent.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { IncomingPriceWithPercentsDto } from './dto/incoming.price.with.percents.dto';

export class GoodsWithPercents {
    constructor(
        private goods: GoodPriceDto[],
        private percents: GoodPercentDto[],
        private defaultPercents: GoodPercentDto,
    ) {}
    getPriceWithPercents(code: string): IncomingPriceWithPercentsDto {
        const gCode = goodCode({ offer_id: code });
        const gCoeff = goodQuantityCoeff({ offer_id: code });
        const incoming_price = this.goods.find((g) => g.code.toString() === gCode).price * gCoeff;
        const { min_perc, perc, old_perc, adv_perc } =
            this.percents.find((p) => p.offer_id.toString() === gCode && p.pieces === gCoeff) || this.defaultPercents;
        return { incoming_price, min_perc, perc, old_perc, adv_perc };
    }
}
