import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { PriceService } from '../price/price.service';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { UpdateOfferDto } from './dto/update.offer.dto';
import { ConfigService } from '@nestjs/config';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { UpdateBusinessOfferPriceDto } from './dto/update.business.offer.price.dto';
import { VaultService } from 'vault-module/lib/vault.service';
import { Cron } from '@nestjs/schedule';
import { GoodsStatsGoodsDto } from '../yandex.offer/dto/goods.stats.goods.dto';
import { GoodsStatsGoodsDtoUpdatePriceableAdapter } from './goods.stats.goods.dto.update.priceable.adapter';
import { toNumber } from 'lodash';
import { GoodCountsDto } from '../interfaces/ICountUpdatebale';
import { IUpdatePriceable } from '../interfaces/IUpdatePriceable';

@Injectable()
export class YandexPriceService implements OnModuleInit {
    private logger = new Logger(YandexPriceService.name);
    private businessId: string;
    constructor(
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private offerService: YandexOfferService,
        private priceService: PriceService,
        private configService: ConfigService,
        private api: YandexApiService,
        private vaultService: VaultService,
    ) {}
    async onModuleInit(): Promise<void> {
        const yandex = await this.vaultService.get('yandex-seller');
        this.businessId = yandex['electronica-business'] as string;
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
    async updatePrices2(offers: GoodCountsDto<GoodsStatsGoodsDto>): Promise<UpdatePriceDto[]> {
        const goodCodes: string[] = this.goodService.getGoodIds(offers.goods.keys());
        const goodsWithPercents = await this.goodService.codesToUpdatePrices(goodCodes);
        const percentsDto = {
            minMil: this.configService.get<number>('YANDEX_MIN_MIL', 40),
            percMil: toNumber(this.configService.get<string>('PERC_MIL', '5.5')),
            percEkv: this.configService.get<number>('YANDEX_PERC_EKV', 1),
            sumObtain: toNumber(this.configService.get<number>('SUM_OBTAIN', 25)),
            sumPack: toNumber(this.configService.get<number>('SUM_PACK', 13)),
        };
        const updatePrices: IUpdatePriceable[] = [];
        for (const good of offers.goods.values()) {
            updatePrices.push(new GoodsStatsGoodsDtoUpdatePriceableAdapter(good, percentsDto));
        }
        return updatePrices.map((u) => u.make(goodsWithPercents));
    }

    @Cron('0 28 20 * * *', { name: 'updateYandexPrices' })
    async updatePrices(level = 0, args = ''): Promise<void> {
        const offers = await this.offerService.getShopSkus(args);
        /*
        const goodCodes: string[] = this.goodService.getGoodIds(offers.goods.keys());
        const goods = await this.goodService.prices(goodCodes);
        const percents = await this.goodService.getPerc(goodCodes);
        const updatePrices: UpdatePriceDto[] = [];
        for (const good of offers.goods.values()) {
            const gCode = goodCode({ offer_id: good.shopSku });
            const gCoeff = goodQuantityCoeff({ offer_id: good.shopSku });
            const incoming_price = goods.find((g) => g.code.toString() === gCode).price * gCoeff;
            if (incoming_price === 0) continue;
            const sales_percent = good.tariffs.find((t) => t.type === GoodsStatsTariffType.FEE).percent;
            const { min_perc, perc, old_perc, adv_perc } = percents.find(
                (p) => p.offer_id.toString() === gCode && p.pieces === gCoeff,
            ) || {
                min_perc: this.configService.get<number>('PERC_MIN'),
                perc: this.configService.get<number>('PERC_NOR'),
                old_perc: this.configService.get<number>('PERC_MAX'),
                adv_perc: 0,
            };
            updatePrices.push(
                this.priceService.calculatePrice({
                    offer_id: good.shopSku,
                    incoming_price,
                    fbs_direct_flow_trans_max_amount: this.calculateTransMaxAmount(good),
                    sales_percent,
                    min_perc,
                    perc,
                    old_perc,
                    adv_perc,
                    min_mil: this.configService.get<number>('YANDEX_MIN_MIL', 40),
                    ekv_perc: this.configService.get<number>('YANDEX_PERC_EKV', 1),
                }),
            );
        }*/
        const updatePrices = await this.updatePrices2(offers);
        await this.update(updatePrices);
        if (offers.nextArgs) {
            await this.updatePrices(level + 1, offers.nextArgs);
        }
        if (level === 0) {
            this.logger.log('All Yandex Prices was updated');
        }
    }
    async update(prices: UpdatePriceDto[]): Promise<any> {
        await this.updateOfferPrices(prices);
        await this.updateIncomingPrices(prices);
    }
    async updateIncomingPrices(prices: UpdatePriceDto[]): Promise<void> {
        const packing =
            this.configService.get<number>('SUM_PACK', 10) + this.configService.get<number>('YANDEX_SUM_PACK', 15);
        const updates = prices.map(
            (price): UpdateOfferDto => ({
                offerId: price.offer_id,
                cofinancePrice: { value: parseInt(price.min_price), currencyId: 'RUR' },
                purchasePrice: { value: Math.ceil(price.incoming_price), currencyId: 'RUR' },
                additionalExpenses: { value: packing, currencyId: 'RUR' },
            }),
        );
        const offerMappings = updates.map((offer) => ({ offer }));
        await this.api.method(`businesses/${this.businessId}/offer-mappings/update`, 'post', {
            offerMappings,
        });
    }

    async updateOfferPrices(prices: UpdatePriceDto[]): Promise<void> {
        const offers = prices.map(
            (price): UpdateBusinessOfferPriceDto => ({
                offerId: price.offer_id,
                price: {
                    currencyId: 'RUR',
                    discountBase: parseFloat(price.old_price),
                    value: parseFloat(price.price),
                },
            }),
        );
        await this.api.method(`businesses/${this.businessId}/offer-prices/updates`, 'post', { offers });
    }
}
