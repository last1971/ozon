import { forwardRef, Inject, Injectable, Logger, Query } from "@nestjs/common";
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
import { OnEvent } from "@nestjs/event-emitter";
import { ExtraGoodService } from "../good/extra.good.service";

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
     *
     * @param {Object} data - Данные о поступивших товарах
     * @param {string[]} data.skus - Массив SKU поступивших товаров
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
            this.logger.log(`Successfully updated prices for ${skus.length} SKUs after incoming goods event`);
        } catch (error) {
            this.logger.error(`Error updating prices after incoming goods: ${error.message}`, error.stack);
        }
    }

}