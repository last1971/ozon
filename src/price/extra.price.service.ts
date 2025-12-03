import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { GoodServiceEnum } from "../good/good.service.enum";
import { IPriceUpdateable } from "../interfaces/i.price.updateable";
import { PriceService } from "./price.service";
import { YandexPriceService } from "../yandex.price/yandex.price.service";
import { WbPriceService } from "../wb.price/wb.price.service";
import { AvitoPriceService } from "../avito.price/avito.price.service";
import { GOOD_SERVICE, IGood } from "../interfaces/IGood";
import { ConfigService } from "@nestjs/config";
import { UpdatePriceDto } from "./dto/update.price.dto";
import { Cron } from "@nestjs/schedule";
import { WbCommissionDto } from "../wb.card/dto/wb.commission.dto";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { ExtraGoodService } from "../good/extra.good.service";
import { toNumber, first } from "lodash";
import { PriceDto } from "./dto/price.dto";
import { ProductVisibility } from "../product/product.visibility";
import { GoodPercentDto } from "../good/dto/good.percent.dto";
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';
import { TradeSkusCommand } from './commands/trade-skus.command';
import { ResetAvailablePriceCommand } from './commands/reset-available-price.command';
import { UpdatePercentsForGoodSkusCommand } from './commands/update-percents-for-good-skus.command';
import { GetAllOzonSkusCommand } from './commands/get-all-ozon-skus.command';
import { OzonSkusToTradeSkusCommand } from './commands/ozon-skus-to-trade-skus.command';
import { UpdatePriceForGoodSkusCommand } from './commands/update-price-for-good-skus.command';
import { CheckPriceDifferenceAndNotifyCommand } from './commands/check-price-difference-and-notify.command';
import { EmitUpdatePromosCommand } from './commands/emit-update-promos.command';
import { LogResultProcessingMessageCommand } from './commands/log-result-processing-message.command';
import { ValidateSkusNotEmptyCommand } from './commands/validate-skus-not-empty.command';
import { SetResultProcessingMessageCommand } from './commands/set-result-processing-message.command';
import { CheckVatCommand } from './commands/check-vat.command';
import { UpdateVatCommand } from './commands/update-vat.command';
import { IVatProcessingContext } from '../interfaces/i.vat.processing.context';
import { IVatUpdateable } from '../interfaces/i.vat.updateable';
import { LoadOzonPricesCommand } from './commands/load-ozon-prices.command';
import { FilterBySellingPriceAboveCommand } from './commands/filter-by-selling-price-above.command';
import { FilterByIncomingPriceBelowCommand } from './commands/filter-by-incoming-price-below.command';
import { CalculatePercentsWithLowCommissionCommand } from './commands/calculate-percents-with-low-commission.command';
import { FilterByMinPriceBelowCommand } from './commands/filter-by-min-price-below.command';
import { UpdateOzonPricesCommand } from './commands/update-ozon-prices.command';
import { NotifyHighPriceCommand } from './commands/notify-high-price.command';
import { CalculateUnprofitableCommand } from './commands/calculate-unprofitable.command';
import { ExportUnprofitableXlsxCommand } from './commands/export-unprofitable-xlsx.command';
import { Buffer } from 'exceljs';

@Injectable()
export class ExtraPriceService {
    private services: Map<GoodServiceEnum, IPriceUpdateable>;
    private readonly logger = new Logger(ExtraPriceService.name);

    constructor(
        private service: PriceService,
        @Inject(forwardRef(() => YandexPriceService)) private yandexPriceService: YandexPriceService,
        private wb: WbPriceService,
        private avitoPriceService: AvitoPriceService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
        private extraGoodService: ExtraGoodService,
        private eventEmitter: EventEmitter2,
        private readonly tradeSkusCommand: TradeSkusCommand,
        private readonly resetAvailablePriceCommand: ResetAvailablePriceCommand,
        private readonly updatePercentsForGoodSkusCommand: UpdatePercentsForGoodSkusCommand,
        private readonly getAllOzonSkusCommand: GetAllOzonSkusCommand,
        private readonly ozonSkusToTradeSkusCommand: OzonSkusToTradeSkusCommand,
        private readonly updatePriceForGoodSkusCommand: UpdatePriceForGoodSkusCommand,
        private readonly checkPriceDifferenceAndNotifyCommand: CheckPriceDifferenceAndNotifyCommand,
        private readonly emitUpdatePromosCommand: EmitUpdatePromosCommand,
        private readonly logResultProcessingMessageCommand: LogResultProcessingMessageCommand,
        private readonly validateSkusNotEmptyCommand: ValidateSkusNotEmptyCommand,
        private readonly setResultProcessingMessageCommand: SetResultProcessingMessageCommand,
        private readonly checkVatCommand: CheckVatCommand,
        private readonly updateVatCommand: UpdateVatCommand,
        private readonly loadOzonPricesCommand: LoadOzonPricesCommand,
        private readonly filterBySellingPriceAboveCommand: FilterBySellingPriceAboveCommand,
        private readonly filterByIncomingPriceBelowCommand: FilterByIncomingPriceBelowCommand,
        private readonly calculatePercentsWithLowCommissionCommand: CalculatePercentsWithLowCommissionCommand,
        private readonly filterByMinPriceBelowCommand: FilterByMinPriceBelowCommand,
        private readonly updateOzonPricesCommand: UpdateOzonPricesCommand,
        private readonly notifyHighPriceCommand: NotifyHighPriceCommand,
        private readonly calculateUnprofitableCommand: CalculateUnprofitableCommand,
        private readonly exportUnprofitableXlsxCommand: ExportUnprofitableXlsxCommand,
    ) {
        this.services = new Map<GoodServiceEnum, IPriceUpdateable>();
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON)) this.services.set(GoodServiceEnum.OZON, service);
        if (services.includes(GoodServiceEnum.YANDEX)) this.services.set(GoodServiceEnum.YANDEX, yandexPriceService);
        if (services.includes(GoodServiceEnum.WB)) this.services.set(GoodServiceEnum.WB, wb);
        if (services.includes(GoodServiceEnum.AVITO)) this.services.set(GoodServiceEnum.AVITO, avitoPriceService);
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
    public updatePriceForServices(skus: string[], pricesMap?: Map<string, UpdatePriceDto>): Promise<{ service: GoodServiceEnum, result: any }[]> {
        const serviceEntries = [...this.services.entries()];
        return Promise.all(
            serviceEntries.map(async ([serviceEnum, service]) => ({
                service: serviceEnum, // это и есть GoodServiceEnum!
                result: await this.goodService.updatePriceForService(service, skus, pricesMap)
            }))
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
        const results = await Promise.all(
            this.getServices().map(async (service) => {
                const errors = await service.updateAllPrices();
                return { service: service.constructor.name, errors: errors || [] };
            }),
        );

        const allErrors = results.filter((r) => r.errors.length > 0);
        if (allErrors.length > 0) {
            const message = allErrors
                .map((r) => `${r.service}: ${r.errors.length} ошибок\n${JSON.stringify(r.errors.slice(0, 10), null, 2)}`)
                .join('\n\n');
            this.eventEmitter.emit('error.message', 'Ошибки обновления цен', message);
        }

        const summary = results.map((r) => `${r.service}: ${r.errors.length} ошибок`).join(', ');
        this.logger.log(`Обновление цен завершено. ${summary}`);
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
        const context: IGoodsProcessingContext = {
            skus,
            logger: this.logger,
        };
        const chain = new CommandChainAsync<IGoodsProcessingContext>([
            this.validateSkusNotEmptyCommand,
            this.tradeSkusCommand,
            this.resetAvailablePriceCommand,
            this.updatePercentsForGoodSkusCommand,
            this.updatePriceForGoodSkusCommand,
            this.checkPriceDifferenceAndNotifyCommand,
            this.emitUpdatePromosCommand,
            this.setResultProcessingMessageCommand,
            this.logResultProcessingMessageCommand,
        ]);
        try {
            await chain.execute(context);
        } catch (error) {
            this.logger.error(`Error updating prices after incoming goods: ${error.message}`, error.stack);
        }
    }

    async handleDiscounts(skus: string[]): Promise<void> {
        const context: IGoodsProcessingContext = {
            skus,
            logger: this.logger,
            resultProcessingMessage: 'Discounts updated',
        };
        const chain = new CommandChainAsync<IGoodsProcessingContext>([
            this.validateSkusNotEmptyCommand,
            this.tradeSkusCommand,
            this.updatePriceForGoodSkusCommand,
            this.checkPriceDifferenceAndNotifyCommand,
            this.logResultProcessingMessageCommand,
        ]);
        try {
            await chain.execute(context);
        } catch (error) {
            this.logger.error(`Error updating discounts: ${error.message}`, error.stack);
        }
    }

    async checkPriceDifferenceAndNotify(ozonSkus: string[]): Promise<void> {
        // 1. Получаем порог разницы из конфигурации (в процентах)
        const thresholdPercent = this.configService.get<number>('PRICE_DIFF_THRESHOLD_PERCENT', 5);
        if (!ozonSkus || ozonSkus.length === 0) {
            this.logger.warn('No trade SKUs provided for price difference check.');
            return;
        }
        try {
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
    public async generatePercentsForOzon(sku: string, goodPercentDto?: Partial<GoodPercentDto>): Promise<GoodPercentDto> {
        const available_prices = goodPercentDto !== null && goodPercentDto !== undefined
            ? new Map([[sku, goodPercentDto]])
            : undefined;
        return first(await this.goodService.generatePercentsForService(
            this.getService(GoodServiceEnum.OZON),
            [sku],  // передаем как массив
            available_prices
        )) as GoodPercentDto;
    }

    /**
     * 
     * @param ozonSkus коды озона
     */
    public async updatePercentsForGoodSkus(ozonSkus: string[]): Promise<void> {
        await this.goodService.updatePercentsForService(this.getService(GoodServiceEnum.OZON), ozonSkus);
    }

    /**
     * Массовое обновление процентов и цен для всех товаров Ozon
     * Получает все SKU из системы, обновляет проценты и цены
     */
    async updateAllPercentsAndPrices(): Promise<void> {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonSkus: [],
            logger: this.logger,
        };

        const chain = new CommandChainAsync<IGoodsProcessingContext>([
            this.getAllOzonSkusCommand,
            this.ozonSkusToTradeSkusCommand,
            this.updatePercentsForGoodSkusCommand,
            this.updatePriceForGoodSkusCommand,
            this.emitUpdatePromosCommand,
            this.setResultProcessingMessageCommand,
            this.logResultProcessingMessageCommand,
        ]);

        try {
            await chain.execute(context);
        } catch (error) {
            this.logger.error(`Ошибка при массовом обновлении процентов и цен: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Оптимизация цен Ozon для товаров с ценой > 300₽
     * Пересчитывает с комиссией 20% вместо 38%+ для товаров с низкой входной ценой
     */
    async optimizeOzonPrices(): Promise<void> {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonSkus: [],
            logger: this.logger,
        };

        const chain = new CommandChainAsync<IGoodsProcessingContext>([
            this.getAllOzonSkusCommand,
            this.loadOzonPricesCommand,
            this.filterBySellingPriceAboveCommand,
            this.filterByIncomingPriceBelowCommand,
            this.calculatePercentsWithLowCommissionCommand,
            this.filterByMinPriceBelowCommand,
            this.updateOzonPricesCommand,
            this.notifyHighPriceCommand,
            this.logResultProcessingMessageCommand,
        ]);

        try {
            await chain.execute(context);
        } catch (error) {
            this.logger.error(`Ошибка при оптимизации цен Ozon: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Проверить и обновить НДС для всех несоответствующих товаров
     * @param service - enum маркетплейса (OZON, WB, YANDEX)
     * @param expectedVat - ожидаемая ставка НДС в процентах (0, 5, 7, 10, 20, 22)
     * @param limit - лимит записей за запрос при проверке
     * @returns результат проверки и обновления
     */
    async updateVatForAllMismatches(
        service: GoodServiceEnum,
        expectedVat: number,
        limit?: number,
    ): Promise<{ mismatches: any[]; updateResult: any }> {
        const priceService = this.getService(service);

        if (!priceService) {
            throw new Error(`Service ${service} not found`);
        }

        if (!this.isVatUpdateable(priceService)) {
            throw new Error(`Service ${service} does not support VAT operations`);
        }

        const context: IVatProcessingContext = {
            service: priceService,
            expectedVat,
            limit: limit || 1000,
            logger: this.logger,
        };

        const chain = new CommandChainAsync<IVatProcessingContext>([
            this.checkVatCommand,
            this.updateVatCommand,
        ]);

        const result = await chain.execute(context);

        return {
            mismatches: result.mismatches || [],
            updateResult: result.updateResult,
        };
    }

    /**
     * Type guard для проверки, поддерживает ли сервис работу с НДС
     */
    private isVatUpdateable(service: IPriceUpdateable): service is IPriceUpdateable & IVatUpdateable {
        return 'checkVatForAll' in service && 'updateVat' in service && 'vatToNumber' in service && 'numberToVat' in service;
    }

    /**
     * Получить отчёт по убыточным товарам Ozon в формате xlsx
     */
    async getUnprofitableReport(): Promise<Buffer> {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonSkus: [],
            logger: this.logger,
        };

        const chain = new CommandChainAsync<IGoodsProcessingContext>([
            this.getAllOzonSkusCommand,
            this.loadOzonPricesCommand,
            this.calculateUnprofitableCommand,
            this.exportUnprofitableXlsxCommand,
        ]);

        const result = await chain.execute(context);
        return result.xlsxBuffer;
    }
}