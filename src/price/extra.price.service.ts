import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { GoodServiceEnum } from "../good/good.service.enum";
import { IPriceUpdateable } from "../interfaces/i.price.updateable";
import { PriceService } from "./price.service";
import { YandexPriceService } from "../yandex.price/yandex.price.service";
import { WbPriceService } from "../wb.price/wb.price.service";
import { GOOD_SERVICE, IGood } from "../interfaces/IGood";
import { ConfigService } from "@nestjs/config";
import { UpdatePriceDto } from "./dto/update.price.dto";
import { Cron } from "@nestjs/schedule";
import { WbCommissionDto } from "../wb.card/dto/wb.commission.dto";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { ExtraGoodService } from "../good/extra.good.service";
import { toNumber } from "lodash";
import { PriceDto } from "./dto/price.dto";
import { ProductVisibility } from "../product/product.visibility";

@Injectable()
export class ExtraPriceService {
    private services: Map<GoodServiceEnum, IPriceUpdateable>;
    private readonly logger = new Logger(ExtraPriceService.name);

    constructor(
        private service: PriceService,
        @Inject(forwardRef(() => YandexPriceService)) private yandexPriceService: YandexPriceService,
        private wb: WbPriceService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
        private extraGoodService: ExtraGoodService,
        private eventEmitter: EventEmitter2,
    ) {
        this.services = new Map<GoodServiceEnum, IPriceUpdateable>();
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON)) this.services.set(GoodServiceEnum.OZON, service);
        if (services.includes(GoodServiceEnum.YANDEX)) this.services.set(GoodServiceEnum.YANDEX, yandexPriceService);
        if (services.includes(GoodServiceEnum.WB)) this.services.set(GoodServiceEnum.WB, wb);
    }

    /**
     * Retrieves a specific service based on the provided service type.
     *
     * @param {GoodServiceEnum} service - The enum value representing the desired service type.
     * @return {IPriceUpdateable | null} Returns the corresponding service object if found, otherwise returns null.
     */
    public getService(service: GoodServiceEnum): IPriceUpdateable {
        return this.services.get(service) || null;
    }
    /**
     * Retrieves all services.
     *
     * @return {IPriceUpdateable[]} Returns an array of all services.
     */
    public getServices(): IPriceUpdateable[] {
        return Array.from<IPriceUpdateable>(this.services.values());
    }

    /**
     * Updates the prices for the specified services based on the provided SKUs and prices map.
     *
     * @param {string[]} skus - An array of SKUs for which the prices need to be updated.
     * @param {Map<string, UpdatePriceDto>} [pricesMap] - An optional map containing the SKUs as keys
     * and the corresponding price update data as values.
     * @return {Promise<any>} A promise that resolves when the price update operation completes for all services.
     */
    public updatePriceForServices(skus: string[], pricesMap?: Map<string, UpdatePriceDto>): Promise<any> {
        return Promise.all(
            this.getServices()
                .map(
                    (service) =>
                        this.goodService.updatePriceForService(service, skus, pricesMap)
                ),
        );
    }

    public updatePriceForGoodSkus(skus: string[]): Promise<any> {
        const serviceEntries = [...this.services.entries()];

        return Promise.all(
            serviceEntries
                .map(
                    ([serviceEnum, service]) => {
                        const serviceSkus = this.extraGoodService.tradeSkusToServiceSkus(skus, serviceEnum);
                        return serviceSkus.length > 0
                            ? this.goodService.updatePriceForService(service, serviceSkus)
                            : null
                    }
                ),
        );
    }

    @Cron('0 0 0 * * 0', { name: 'updateAllServicePrices' })
    async updateAllPrices(): Promise<void> {
        await Promise.all(this.getServices().map((service) => service.updateAllPrices()));
    }

    async getWbCoeff(name: string): Promise<WbCommissionDto> {
        return this.goodService.getWbCategoryByName(name);
    }

    /**
     * Обработчик события получения входящих товаров.
     * Обновляет цены для всех маркетплейсов на основе новых поступлений товаров.
     * @param skus
     */
    @OnEvent('incoming.goods', { async: true })
    async handleIncomingGoods(skus: string[]): Promise<void> {

        if (!skus || skus.length === 0) {
            this.logger.log('No incoming goods SKUs provided');
            return;
        }

        this.logger.log(`Processing incoming goods for ${skus.length} SKUs`);

        try {
            // Сначала обнуляем available_price для всех поступивших товаров
            await this.goodService.resetAvailablePrice(skus);
            // Обновляем цены для всех маркетплейсов на основе поступивших товаров
            await this.updatePriceForGoodSkus(skus);
            // Затем проверяем разницу цен и отправляем уведомление, если необходимо
            await this.checkPriceDifferenceAndNotify(skus);
            // Отправляем уведомление о завершении обработки
            this.logger.log(`Successfully updated prices for ${skus.length} SKUs after incoming goods event`);
        } catch (error) {
            this.logger.error(`Error updating prices after incoming goods: ${error.message}`, error.stack);
        }
    }

    async checkPriceDifferenceAndNotify(tradeSkus: string[]): Promise<void> {
        // 1. Получаем порог разницы из конфигурации (в процентах)
        const thresholdPercent = this.configService.get<number>('PRICE_DIFF_THRESHOLD_PERCENT', 5);
        if (!tradeSkus || tradeSkus.length === 0) {
            this.logger.warn('No trade SKUs provided for price difference check.');
            return;
        }
        try {
            // 2. Преобразуем Trade SKU в Ozon SKU
            const ozonSkus = this.extraGoodService.tradeSkusToServiceSkus(tradeSkus, GoodServiceEnum.OZON);
            if (ozonSkus.length === 0) {
                this.logger.warn('No Ozon SKUs found for the provided trade SKUs.');
                return;
            }
            // 3. Получаем цены для Ozon SKUs
            const priceResponse = await this.service.index({
                offer_id: ozonSkus,
                limit: ozonSkus.length * 2, // Запас на случай дублей или неточностей
                visibility: ProductVisibility.ALL, // Получаем все товары, независимо от видимости
            });
            const productsToCheck = priceResponse.data;
            // 4. Фильтруем товары по разнице цен
            const problematicProducts: Array<PriceDto & { diffPercent: number }> = this.filterProblematicProducts(
                productsToCheck,
                thresholdPercent
            );
            if (problematicProducts.length > 0) {
                this.eventEmitter.emit(
                    'problematic.prices', // Название события
                    { products: problematicProducts, thresholdPercent },
                );
            } else {
                this.logger.log('No products found exceeding the price difference threshold. No report sent.');
            }
        } catch (error) {
            this.logger.error(`Error during price difference check: ${error.message}`, error.stack);
        }
    }

    /**
     * Filters out products with a price difference exceeding the specified threshold percentage.
     * Сейчас убрал фильтрацию но скорее всего потребуется в будущем
     * @param products
     * @param thresholdPercent
     * @private
     */
    private filterProblematicProducts(
        products: PriceDto[],
        thresholdPercent: number
    ): Array<PriceDto & { diffPercent: number }> {
        return products.map((product): PriceDto & { diffPercent: number } => {
            const marketingPrice = toNumber(product.marketing_seller_price);
            const minPrice = toNumber(product.min_price);
            const diff = Math.abs(marketingPrice - minPrice);
            const diffPercent = Math.round((diff / minPrice) * 100);
            return { ...product, diffPercent };
        });
        /*
        const problematicProducts: Array<PriceDto & { diffPercent: number }> = [];
        products.forEach(item => {
            const marketingPrice = toNumber(item.marketing_seller_price);
            const minPrice = toNumber(item.min_price);

            if (minPrice > 0 && marketingPrice > 0) {
                const diff = Math.abs(marketingPrice - minPrice);
                const diffPercent = (diff / minPrice) * 100;

                if (diffPercent > thresholdPercent) {
                    problematicProducts.push({ ...item, diffPercent });
                }
            } else if (minPrice <= 0 && marketingPrice > 0) {
                this.logger.warn(`Product ${item.offer_id} (${item.name}) has invalid min_price (${item.min_price}) but valid marketing_price (${item.marketing_seller_price}). Skipping percentage check.`);
            }
        });
        return problematicProducts;
        */
    }
}