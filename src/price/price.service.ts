import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from './dto/price.request.dto';
import { PricePresetDto } from './dto/price.preset.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { PriceResponseDto } from './dto/price.response.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { AutoAction, UpdatePriceDto, UpdatePricesDto } from './dto/update.price.dto';
import { PriceDto } from './dto/price.dto';
import { toNumber } from 'lodash';
import { Cron } from '@nestjs/schedule';
import { ProductVisibility } from '../product/product.visibility';

@Injectable()
export class PriceService {
    private logger = new Logger(PriceService.name);
    constructor(
        private product: ProductService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
    ) {}
    async preset(): Promise<PricePresetDto> {
        return {
            perc_min: toNumber(this.configService.get<number>('PERC_MIN', 15)),
            perc_nor: toNumber(this.configService.get<number>('PERC_NOR', 30)),
            perc_max: toNumber(this.configService.get<number>('PERC_MAX', 100)),
            perc_mil: toNumber(this.configService.get<number>('PERC_MIL', 5.5)),
            perc_ekv: toNumber(this.configService.get<number>('PERC_EKV', 1.5)),
            sum_obtain: toNumber(this.configService.get<number>('SUM_OBTAIN', 25)),
            sum_pack: toNumber(this.configService.get<number>('SUM_PACK', 13)),
        };
    }

    async index(request: PriceRequestDto): Promise<PriceResponseDto> {
        const products = await this.product.getPrices(request);
        const codes = products.items.map((item) => goodCode(item));
        const goods = await this.goodService.prices(codes);
        const percents = await this.goodService.getPerc(codes);
        return {
            last_id: products.last_id,
            data: products.items.map((item) => {
                const good = goods.find((g) => g.code.toString() === goodCode(item));
                const percent: GoodPercentDto = percents.find(
                    (p) => p.offer_id.toString() === goodCode(item) && p.pieces === goodQuantityCoeff(item),
                ) || {
                    offer_id: item.offer_id,
                    pieces: goodQuantityCoeff(item),
                    adv_perc: 0,
                    old_perc: this.configService.get<number>('PERC_MAX', 50),
                    perc: this.configService.get<number>('PERC_NOR', 25),
                    min_perc: this.configService.get<number>('PERC_MIN', 15),
                };
                return {
                    product_id: item.product_id,
                    offer_id: item.offer_id,
                    name: good.name,
                    marketing_price: item.price.marketing_price,
                    marketing_seller_price: item.price.marketing_seller_price,
                    incoming_price: good.price * goodQuantityCoeff(item),
                    min_price: item.price.min_price,
                    price: item.price.price,
                    old_price: item.price.old_price,
                    min_perc: percent.min_perc,
                    perc: percent.perc,
                    old_perc: percent.old_perc,
                    adv_perc: percent.adv_perc,
                    sales_percent: item.commissions.sales_percent + 1,
                    fbs_direct_flow_trans_max_amount: item.commissions.fbs_direct_flow_trans_max_amount,
                    auto_action_enabled: item.price.auto_action_enabled,
                };
            }),
        };
    }
    async update(prices: UpdatePricesDto): Promise<any> {
        return this.product.setPrice(prices);
    }
    calculatePrice(price: PriceDto, auto_action = AutoAction.UNKNOWN): UpdatePriceDto {
        const calc = (percent: number, price: PriceDto): string =>
            Math.ceil(
                (toNumber(price.incoming_price) * (1 + toNumber(percent) / 100) +
                    toNumber(this.configService.get<number>('SUM_OBTAIN', 25)) +
                    toNumber(this.configService.get<number>('SUM_PACK', 13)) +
                    toNumber(price.fbs_direct_flow_trans_max_amount)) /
                    (1 -
                        (toNumber(price.sales_percent) +
                            toNumber(price.adv_perc) +
                            toNumber(this.configService.get<string>('PERC_MIL', '5.5')) +
                            toNumber(this.configService.get<string>('PERC_EKV', '1.5'))) /
                            100),
            ).toString();
        return {
            auto_action_enabled: auto_action,
            currency_code: 'RUB',
            min_price: calc(price.min_perc, price),
            offer_id: price.offer_id,
            old_price: calc(price.old_perc, price),
            price: calc(price.perc, price),
        };
    }
    @Cron('0 0 0 * * 0', { name: 'updatePrices' })
    async updatePrices(level = 0, last_id = '', visibility = ProductVisibility.IN_SALE, limit = 1000): Promise<any> {
        const pricesForObtain = await this.index({ limit, last_id, visibility });
        let answer = [];
        if (pricesForObtain.data.length > 0) {
            const prices = pricesForObtain.data
                .filter((price) => price.incoming_price > 1)
                .map((price) => this.calculatePrice(price, AutoAction.ENABLED));
            const res = await this.update({ prices });
            answer = res.result
                .filter((update: any) => !update.updated)
                .concat(await this.updatePrices(level + 1, pricesForObtain.last_id));
        }
        if (level === 0) {
            this.logger.log('Update prices was finished');
            if (answer.length > 0) this.logger.error(answer);
        }
        return answer;
    }
}
