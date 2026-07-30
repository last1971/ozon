import { Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ProductService } from "../product/product.service";
import { YandexOfferService } from "../yandex.offer/yandex.offer.service";
import { ExpressOfferService } from "../yandex.offer/express.offer.service";
import { WbCardService } from "../wb.card/wb.card.service";
import { AvitoCardService } from "../avito.card/avito.card.service";
import { SyliusProductService } from "../sylius/sylius.product.service";
import { GOOD_SERVICE, IGood } from "../interfaces/IGood";
import { ICountUpdateable } from "../interfaces/ICountUpdatebale";
import { GoodServiceEnum } from "./good.service.enum";
import { ResultDto } from "../helpers/dto/result.dto";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { IsSwitchedDto } from "./dto/is.switched.dto";
import { chunk } from "lodash";
import { Cron } from "@nestjs/schedule";
import { GoodDto } from "./dto/good.dto";
import { ConfigService } from "@nestjs/config";
import { Environment } from "../env.validation";
import { ProductInfoDto } from "../product/dto/product.info.dto";
import { GoodsCountProcessor } from "../helpers/good/goods.count.processor";
import { loadRows, readColumnByHeader } from '../helpers';
import { GoodWbDto } from "./dto/good.wb.dto";
import { GoodAvitoDto } from "./dto/good.avito.dto";
import { GoodPercentDto } from "./dto/good.percent.dto";

@Injectable()
export class ExtraGoodService implements OnApplicationBootstrap {
    private logger = new Logger(ExtraGoodService.name);
    private services: Map<GoodServiceEnum, { service: ICountUpdateable; isSwitchedOn: boolean }>;
    constructor(
        private productService: ProductService,
        private yandexOffer: YandexOfferService,
        private expressOffer: ExpressOfferService,
        private wbCard: WbCardService,
        private avitoCard: AvitoCardService,
        private syliusProduct: SyliusProductService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
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
        if (services.includes(GoodServiceEnum.SYLIUS))
            this.services.set(GoodServiceEnum.SYLIUS, { service: this.syliusProduct, isSwitchedOn: true });
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
        if (!service) {
            return {
                isSuccess: false,
                message: `Service ${serviceEnum} not configured`,
            };
        }
        const processor = new GoodsCountProcessor(this.services, this.logger, this.goodService);
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
        if (!service) {
            return {
                isSuccess: false,
                message: `Service ${isSwitchedDto.service} not configured`,
            };
        }
        service.isSwitchedOn = isSwitchedDto.isSwitchedOn;
        const processor = new GoodsCountProcessor(this.services, this.logger, this.goodService);
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
        if (!service.isSwitchedOn) {
            return this.zeroBalances(serviceEnum, service.service.skuList);
        }
        return 0;
    }

    /**
     * Ядро обнуления остатков: пушит 0 для переданных SKU чанками по 100.
     * Переиспользуется resetBalances (весь сервис) и PushZeroCountsCommand (подмножество).
     */
    async zeroBalances(serviceEnum: GoodServiceEnum, skuList: string[]): Promise<number> {
        const service = this.services.get(serviceEnum);
        let count = 0;
        for (const skus of chunk(skuList, 100)) {
            const updateSkus = new Map<string, number>(skus.map((sku) => [sku, 0]));
            count += await service.service.updateGoodCounts(updateSkus);
        }
        return count;
    }

    /**
     * Отключить конкретные товары (обнулить остаток) по списку SKU маркетплейса.
     * @param serviceEnum - Тип сервиса (маркетплейса)
     * @param skus - SKU маркетплейса для отключения
     */
    async disableByCodes(serviceEnum: GoodServiceEnum, skus: string[]): Promise<ResultDto> {
        const service = this.services.get(serviceEnum);
        if (!service) {
            return { isSuccess: false, message: `Service ${serviceEnum} not configured` };
        }
        const skuList = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))];
        if (!skuList.length) {
            return { isSuccess: false, message: `Не передано ни одного SKU для ${serviceEnum}` };
        }
        const count = await this.zeroBalances(serviceEnum, skuList);
        return { isSuccess: true, message: `Service ${serviceEnum} disabled ${count} skus` };
    }

    /** Столбец SKU из xlsx (заголовок «SKU»/«Артикул»/«Артикул продавца»). */
    async skusFromFile(buffer: Buffer): Promise<string[]> {
        return readColumnByHeader(buffer, ['SKU', 'sku', 'Артикул продавца', 'Артикул']);
    }

    async onApplicationBootstrap(): Promise<void> {
        if (this.configService.get<Environment>('NODE_ENV') !== 'production') {
            return;
        }
        // Загружаем все сервисы параллельно — они независимы (свой маркетплейс, свой skuList, свой ключ Map).
        // loadSkuList сам ловит падение и наружу не бросает; allSettled — подстраховка от неожиданного throw.
        await Promise.allSettled(
            Array.from(this.services.keys()).map((serviceEnum) => this.loadSkuList(serviceEnum)),
        );
    }

    async loadSkuList(serviceEnum: GoodServiceEnum): Promise<ResultDto> {
        const service = this.services.get(serviceEnum);
        if (!service) {
            return {
                isSuccess: false,
                message: `Service ${serviceEnum} not configured`,
            };
        }
        if (service.isSwitchedOn) {
            try {
                await service.service.loadSkuList();
            } catch (error) {
                service.isSwitchedOn = false;
                const subject = `Сервис ${serviceEnum} отключён: ошибка загрузки SKU`;
                let message = error.message;
                if (error.response?.data) {
                    try {
                        message += '\nОтвет: ' + JSON.stringify(error.response.data);
                    } catch {
                        // тело ответа не сериализуется — оставляем только error.message
                    }
                }
                this.logger.error(`${subject}. ${message}`);
                this.eventEmitter.emit('error.message', subject, message);
                return { isSuccess: false, message: subject };
            }
        }
        return {
            isSuccess: service.isSwitchedOn,
            message: `Service ${serviceEnum} ${service.isSwitchedOn ? 'load sku list' : 'is switched off'}`,
        };
    }

    @Cron('0 0 9-19 * * 1-6', { name: 'controlCheckGoodCount' })
    async checkGoodCount(): Promise<void> {
        const processor = new GoodsCountProcessor(this.services, this.logger, this.goodService);
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

        const processor = new GoodsCountProcessor(this.services, this.logger, this.goodService);

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

    async importWbFromXlsx(buffer: Buffer): Promise<{ updated: number; errors: number }> {
        let updated = 0, errors = 0;
        for (const row of await loadRows(buffer)) {
            try {
                const id = row[0];
                if (!id) continue;
                const dto: GoodWbDto = {
                    id,
                    commission: Number(row[1]) || 0,
                    tariff: Number(row[2]) || 0,
                };
                if (row[3] !== '' && row[3] !== undefined) dto.minPrice = Number(row[3]);
                if (row[4] !== '' && row[4] !== undefined) dto.wbCategoriesId = Number(row[4]);
                this.goodService.setWbData(dto, null);
                updated++;
            } catch (e) {
                errors++;
                this.logger.error(`importWb row error: ${e.message}`);
            }
        }
        return { updated, errors };
    }

    async importAvitoFromXlsx(buffer: Buffer): Promise<{ updated: number; errors: number }> {
        let updated = 0, errors = 0;
        for (const row of await loadRows(buffer)) {
            try {
                const id = row[0];
                if (!id) continue;
                const dto: GoodAvitoDto = {
                    id,
                    goodsCode: row[1] || '',
                    coeff: Number(row[2]) || 0,
                    commission: Number(row[3]) || 0,
                };
                this.goodService.setAvitoData(dto, null);
                updated++;
            } catch (e) {
                errors++;
                this.logger.error(`importAvito row error: ${e.message}`);
            }
        }
        return { updated, errors };
    }

    async importPercentFromXlsx(buffer: Buffer): Promise<{ updated: number; errors: number }> {
        let updated = 0, errors = 0;
        for (const row of await loadRows(buffer)) {
            try {
                const offer_id = row[0];
                if (!offer_id) continue;
                const dto: GoodPercentDto = { offer_id };
                if (row[1] !== '' && row[1] !== undefined) dto.min_perc = Number(row[1]);
                if (row[2] !== '' && row[2] !== undefined) dto.perc = Number(row[2]);
                if (row[3] !== '' && row[3] !== undefined) dto.old_perc = Number(row[3]);
                if (row[4] !== '' && row[4] !== undefined) dto.adv_perc = Number(row[4]);
                if (row[5] !== '' && row[5] !== undefined) dto.packing_price = Number(row[5]);
                if (row[6] !== '' && row[6] !== undefined) dto.available_price = Number(row[6]);
                this.goodService.setPercents(dto, null);
                updated++;
            } catch (e) {
                errors++;
                this.logger.error(`importPercent row error: ${e.message}`);
            }
        }
        return { updated, errors };
    }
}
