import { Inject, Injectable, Logger } from "@nestjs/common";
import { ProductService } from "../product/product.service";
import { YandexOfferService } from "../yandex.offer/yandex.offer.service";
import { ExpressOfferService } from "../yandex.offer/express.offer.service";
import { WbCardService } from "../wb.card/wb.card.service";
import { AvitoCardService } from "../avito.card/avito.card.service";
import { GOOD_SERVICE, IGood } from "../interfaces/IGood";
import { ICountUpdateable } from "../interfaces/ICountUpdatebale";
import { GoodServiceEnum } from "./good.service.enum";
import { ResultDto } from "../helpers/dto/result.dto";
import { OnEvent } from "@nestjs/event-emitter";
import { IsSwitchedDto } from "./dto/is.switched.dto";
import { chunk } from "lodash";
import { Cron } from "@nestjs/schedule";
import { GoodDto } from "./dto/good.dto";
import { ConfigService } from "@nestjs/config";
import { ProductInfoDto } from "../product/dto/product.info.dto";
import { GoodsCountProcessor } from "../helpers/good/goods.count.processor";

@Injectable()
export class ExtraGoodService {
    private logger = new Logger(ExtraGoodService.name);
    private services: Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>;
    constructor(
        private productService: ProductService,
        private yandexOffer: YandexOfferService,
        private expressOffer: ExpressOfferService,
        private wbCard: WbCardService,
        private avitoCard: AvitoCardService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
    ) {
        this.services = new Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>();
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON))
            this.services.set(GoodServiceEnum.OZON, { service: this.productService, isSwitchedOn: true });
        if (services.includes(GoodServiceEnum.WB))
            this.services.set(GoodServiceEnum.WB, { service: this.wbCard, isSwitchedOn: true });
        if (services.includes(GoodServiceEnum.EXPRESS))
            this.services.set(GoodServiceEnum.EXPRESS, { service: this.expressOffer, isSwitchedOn: true });
        if (services.includes(GoodServiceEnum.YANDEX))
            this.services.set(GoodServiceEnum.YANDEX, { service: this.yandexOffer, isSwitchedOn: true });
        if (services.includes(GoodServiceEnum.AVITO))
            this.services.set(GoodServiceEnum.AVITO, { service: this.avitoCard, isSwitchedOn: true });
    }

    /**
     * Публичный метод для получения сервиса обновления количества товаров.
     * Возвращает сервис ICountUpdateable, если он найден и включен, иначе null.
     * @param serviceEnum - Тип сервиса (маркетплейса)
     */
    public getCountUpdateableService(serviceEnum: GoodServiceEnum): ICountUpdateable | null {
        return this.services.get(serviceEnum)?.service || null;
    }

    async updateService(serviceEnum: GoodServiceEnum): Promise<ResultDto> {
        const service = this.services.get(serviceEnum);
        const processor = new GoodsCountProcessor(this.services, this.logger);
        return {
            isSuccess: service.isSwitchedOn,
            message: service.isSwitchedOn
                ? `Was updated ${await processor.processGoodsCountForService(
                    serviceEnum,
                    this.goodService,
                    ''
                  )} offers in ${serviceEnum}`
                : `${serviceEnum} switched off`,
        };
    }

    async serviceIsSwitchedOn(isSwitchedDto: IsSwitchedDto): Promise<ResultDto> {
        const service = this.services.get(isSwitchedDto.service);
        service.isSwitchedOn = isSwitchedDto.isSwitchedOn;
        const processor = new GoodsCountProcessor(this.services, this.logger);
        let count: number;
        if (isSwitchedDto.isSwitchedOn) {
            count = await processor.processGoodsCountForService(isSwitchedDto.service, this.goodService, '');
        } else {
            count = await this.resetBalances(isSwitchedDto.service);
        }
        return {
            isSuccess: true,
            message: `Service ${isSwitchedDto.service} ${
                isSwitchedDto.isSwitchedOn
                    ? `is switched on and restore ${count} skus`
                    : `is switched off and reset ${count} skus`
            }`,
        };
    }

    async resetBalances(serviceEnum: GoodServiceEnum): Promise<number> {
        const service = this.services.get(serviceEnum);
        let count = 0;
        if (!service.isSwitchedOn) {
            const chunkSkuList = chunk(service.service.skuList, 100);
            for (const skuList of chunkSkuList) {
                const updateSkus = new Map<string, number>(skuList.map((sku) => [sku, 0]));
                count += await service.service.updateGoodCounts(updateSkus);
            }
        }
        return count;
    }

    async loadSkuList(serviceEnum: GoodServiceEnum): Promise<ResultDto> {
        const service = this.services.get(serviceEnum);
        if (service.isSwitchedOn) {
            await service.service.loadSkuList();
        }
        return {
            isSuccess: service.isSwitchedOn,
            message: `Service ${serviceEnum} ${service.isSwitchedOn ? 'load sku list' : 'is switched off'}`,
        };
    }

    @Cron('0 0 9-19 * * 1-6', { name: 'controlCheckGoodCount' })
    async checkGoodCount(): Promise<void> {
        const processor = new GoodsCountProcessor(this.services, this.logger);
        for (const service of this.services.keys()) {
            this.logger.log(
                `Update quantity for ${await processor.processGoodsCountForService(
                    service,
                    this.goodService,
                    '',
                )} goods in ${service}`,
            );

        }
    }

    // Logic was changed on countsChanged method
    // @OnEvent('reserve.created', { async: true })
    async reserveCreated(skus: string[]): Promise<void> {
        this.logger.log('Sku - ' + skus.join() + ' was reserved');
        let count: number = 0;
        for (const service of this.services) {
            if (service[1].isSwitchedOn)
                try {
                    count += await this.goodService.updateCountForSkus(service[1].service, skus);
                } catch (e) {
                    this.logger.error(e.message, e);
                }
            else this.logger.log(`Service ${service[0]} is switched off`);
        }
        this.logger.log(`Update quantity for ${count} goods`);
    }

    @OnEvent('counts.changed', { async: true })
    async countsChanged(goods: GoodDto[]): Promise<void> {
        this.logger.log(`SKUs changed: ${goods.map((good) => good.code).join(', ')}`);

        const processor = new GoodsCountProcessor(this.services, this.logger);

        await processor.processGoodsCountChanges(goods);
    }

    async getProductInfo(offer_id: string[], service: GoodServiceEnum): Promise<ProductInfoDto[]> {
        return this.services.get(service).service.infoList(offer_id);
    }

    tradeSkusToServiceSkus(tradeSkus: string[], serviceEnum: GoodServiceEnum): string[] {
        const service = this.getCountUpdateableService(serviceEnum);
        if (!service || !service.skuList) return [];
        return service.skuList
            .filter(
                (serviceSku) => tradeSkus.some((tradeSku) => serviceSku.startsWith(tradeSku))
            );
    }

    getSkuList(serviceEnum: GoodServiceEnum): string[] {
        const service = this.getCountUpdateableService(serviceEnum);
        return service?.skuList || [];
    }
}
