import { Inject, Injectable, Logger } from "@nestjs/common";
import { ProductService } from "../product/product.service";
import { YandexOfferService } from "../yandex.offer/yandex.offer.service";
import { ExpressOfferService } from "../yandex.offer/express.offer.service";
import { WbCardService } from "../wb.card/wb.card.service";
import { GOOD_SERVICE, IGood } from "../interfaces/IGood";
import { ICountUpdateable } from "../interfaces/ICountUpdatebale";
import { GoodServiceEnum } from "./good.service.enum";
import { ResultDto } from "../helpers/result.dto";
import { OnEvent } from "@nestjs/event-emitter";
import { IsSwitchedDto } from "./dto/is.switched.dto";
import { chunk } from "lodash";
import { goodQuantityCoeff, productQuantity } from "../helpers";
import { Cron } from "@nestjs/schedule";
import { GoodDto } from "./dto/good.dto";
import { ConfigService } from "@nestjs/config";
// import { ProductVisibility } from "../product/product.visibility";
// import { ProductListResultDto } from "../product/dto/product.list.result.dto";
import { ProductInfoDto } from "../product/dto/product.info.dto";

@Injectable()
export class ExtraGoodService {
    private logger = new Logger(ExtraGoodService.name);
    private services: Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>;
    constructor(
        private productService: ProductService,
        private yandexOffer: YandexOfferService,
        private expressOffer: ExpressOfferService,
        private wbCard: WbCardService,
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
    }

    async updateService(serviceEnum: GoodServiceEnum): Promise<ResultDto> {
        const service = this.services.get(serviceEnum);
        return {
            isSuccess: service.isSwitchedOn,
            message: service.isSwitchedOn
                ? `Was updated ${await this.goodService.updateCountForService(
                      service.service,
                      '',
                  )} offers in ${serviceEnum}`
                : `${serviceEnum} switched off`,
        };
    }

    async serviceIsSwitchedOn(isSwitchedDto: IsSwitchedDto): Promise<ResultDto> {
        const service = this.services.get(isSwitchedDto.service);
        service.isSwitchedOn = isSwitchedDto.isSwitchedOn;
        let count: number;
        if (isSwitchedDto.isSwitchedOn) {
            count = await this.goodService.updateCountForService(service.service, '');
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
        for (const service of this.services) {
            if (service[1].isSwitchedOn) {
                this.logger.log(
                    `Update quantity for ${await this.goodService.updateCountForService(
                        service[1].service,
                        '',
                    )} goods in ${service[0]}`,
                );
            }
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
        this.logger.log('Skus - ' + goods.map((good) => good.code).join() + ' was changed');
        for (const key of this.services.keys()) {
            const service = this.services.get(key);
            if (!service.isSwitchedOn) continue;
            const forChange = new Map<string, number>();
            goods.forEach((good) => {
                const filtredSkus = service.service.skuList.filter((sku) => sku.includes(good.code));
                filtredSkus.forEach((fs) => {
                    const coeff = goodQuantityCoeff({ offer_id: fs });
                    forChange.set(fs, productQuantity(good.quantity - (good.reserve ?? 0), coeff));
                });
            });
            if (forChange.size > 0) {
                this.logger.log(`Update ${await service.service.updateGoodCounts(forChange)} skus in ${key}`);
            }
        }
    }

    async getProductInfo(offer_id: string[], service: GoodServiceEnum): Promise<ProductInfoDto[]> {
        return this.services.get(service).service.infoList(offer_id);
    }
}
