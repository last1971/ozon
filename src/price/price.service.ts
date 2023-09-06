import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from './dto/price.request.dto';
import { PricePresetDto } from './dto/price.preset.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { PriceResponseDto } from './dto/price.response.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { UpdatePriceDto, UpdatePricesDto } from './dto/update.price.dto';
import { toNumber } from 'lodash';
import { Cron } from '@nestjs/schedule';
import { ProductVisibility } from '../product/product.visibility';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';

@Injectable()
export class PriceService implements IPriceUpdateable {
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
            sum_pack:
                toNumber(this.configService.get<number>('SUM_PACK', 10)) +
                toNumber(this.configService.get<number>('SUM_LABEL', 2)),
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
                    sales_percent: item.commissions.sales_percent_fbs,
                    fbs_direct_flow_trans_max_amount: item.commissions.fbs_direct_flow_trans_max_amount,
                    auto_action_enabled: item.price.auto_action_enabled,
                };
            }),
        };
    }
    async update(prices: UpdatePricesDto): Promise<any> {
        return this.product.setPrice(prices);
    }
    @Cron('0 0 0 * * 0', { name: 'updateOzonPrices' })
    async updateAllPrices(level = 0, last_id = '', visibility = ProductVisibility.IN_SALE, limit = 1000): Promise<any> {
        const pricesForObtain = await this.product.getPrices({ limit, last_id, visibility });
        let answer = [];
        if (pricesForObtain.items.length > 0) {
            const res = await this.goodService.updatePriceForService(
                this,
                pricesForObtain.items.map((p) => p.offer_id),
            );
            answer = res.result
                .filter((update: any) => !update.updated)
                .concat(await this.updateAllPrices(level + 1, pricesForObtain.last_id));
        }
        if (level === 0) {
            this.logger.log('Update ozon prices was finished');
            if (answer.length > 0) this.logger.error(answer);
        }
        return answer;
    }

    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: this.configService.get<number>('MIN_MIL', 20),
            percMil: toNumber(this.configService.get<number>('PERC_MIL', 5.5)),
            percEkv: toNumber(this.configService.get<number>('PERC_EKV', 1.5)),
            sumObtain: toNumber(this.configService.get<number>('SUM_OBTAIN', 25)),
            sumLabel: toNumber(this.configService.get<number>('SUM_LABEL', 13)),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        const response = await this.product.getPrices({
            offer_id: skus,
            limit: 1000,
            visibility: ProductVisibility.IN_SALE,
        });
        return response.items.map((product) => new OzonProductCoeffsAdapter(product));
    }

    async updatePrices(updatePrices: UpdatePriceDto[]): Promise<any> {
        return this.update({ prices: updatePrices });
    }
}
