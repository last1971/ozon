import { Inject, Injectable } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from './dto/price.request.dto';
import { PricePresetDto } from './dto/price.preset.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { PriceResponseDto } from './dto/price.response.dto';

@Injectable()
export class PriceService {
    constructor(
        private product: ProductService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
    ) {}
    async preset(): Promise<PricePresetDto> {
        return {
            perc_min: this.configService.get<number>('PERC_MIN', 15),
            perc_nor: this.configService.get<number>('PERC_NOR', 30),
            perc_max: this.configService.get<number>('PERC_MAX', 100),
            perc_mil: 5.5,
            perc_ekv: 1.5,
            sum_obtain: 25,
            sum_pack: 13,
        };
    }

    async index(request: PriceRequestDto): Promise<PriceResponseDto> {
        const products = await this.product.getPrices(request);
        const goods = await this.goodService.prices(products.items.map((item) => item.offer_id));
        return {
            last_id: products.last_id,
            data: products.items.map((item) => {
                const good = goods.find((g) => g.code.toString() === item.offer_id);
                return {
                    product_id: item.product_id,
                    offer_id: item.offer_id,
                    name: good.name,
                    marketing_price: item.price.marketing_price,
                    marketing_seller_price: item.price.marketing_seller_price,
                    incoming_price: good.price,
                    min_price: item.price.min_price,
                    price: item.price.price,
                    old_price: item.price.old_price,
                    min_perc: good.perc_min,
                    perc: good.perc_nor,
                    old_perc: good.perc_max,
                    adv_perc: good.perc_adv,
                    sales_percent: item.commissions.sales_percent + 1,
                    fbs_direct_flow_trans_max_amount: item.commissions.fbs_direct_flow_trans_max_amount,
                };
            }),
        };
    }
}
