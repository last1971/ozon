import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from './dto/price.request.dto';
import { PricePresetDto } from './dto/price.preset.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { PriceResponseDto } from './dto/price.response.dto';
import { PriceDto } from './dto/price.dto';
import { calculatePay, calculatePrice, goodCode, goodQuantityCoeff } from '../helpers';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import { UpdatePriceDto, UpdatePricesDto } from './dto/update.price.dto';
import { chunk, toNumber } from 'lodash';
import { ProductVisibility } from '../product/product.visibility';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { OzonProductCoeffsAdapter } from './ozon.product.coeffs.adapter';
import { ProductPriceDto } from './dto/product.price.dto';
import { Cache } from '@nestjs/cache-manager';
import Excel from 'exceljs';
import { IVatUpdateable } from 'src/interfaces/i.vat.updateable';
import { OzonCommissionDto } from './dto/ozon.commission.dto';
import { IPriceable } from '../interfaces/i.priceable';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';

@Injectable()
export class PriceService implements IPriceUpdateable, IVatUpdateable {
    private logger = new Logger(PriceService.name);
    constructor(
        private product: ProductService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
        private cacheManager: Cache,
        private priceCalculationHelper: PriceCalculationHelper,
    ) {}
    /**
     * Преобразует значение НДС Озона (строка как доля) в число (проценты)
     * '0.05' -> 5, '0.07' -> 7, '0.1' -> 10, '0.2' -> 20, '0.22' -> 22, остальное -> 0
     */
    vatToNumber(vat: any): number {
        const vatStr = typeof vat === 'number' ? vat.toString() : vat;

        switch (vatStr) {
            case '0.05':
                return 5;
            case '0.07':
                return 7;
            case '0.1':
                return 10;
            case '0.2':
                return 20;
            case '0.22':
                return 22;
            default:
                return 0;
        }
    }

    /**
     * Преобразует число (проценты) в формат НДС для Озона (строка как доля)
     * 5 -> '0.05', 7 -> '0.07', 10 -> '0.1', 20 -> '0.2', 22 -> '0.22', остальное -> '0'
     */
    numberToVat(vat: number): string {
        switch (vat) {
            case 5:
                return '0.05';
            case 7:
                return '0.07';
            case 10:
                return '0.1';
            case 20:
                return '0.2';
            case 22:
                return '0.22';
            default:
                return '0';
        }
    }
    async preset(): Promise<PricePresetDto> {
        return {
            perc_min: toNumber(this.configService.get<number>('PERC_MIN', 15)),
            perc_nor: toNumber(this.configService.get<number>('PERC_NOR', 30)),
            perc_max: toNumber(this.configService.get<number>('PERC_MAX', 100)),
            perc_mil: toNumber(this.configService.get<number>('PERC_MIL', 5.5)),
            min_mil: toNumber(this.configService.get<number>('MIN_MIL', 20)),
            perc_ekv: toNumber(this.configService.get<number>('PERC_EKV', 1.5)),
            sum_obtain: toNumber(this.configService.get<number>('SUM_OBTAIN', 25)),
            sum_pack: toNumber(this.configService.get<number>('SUM_PACK', 10)),
            sum_label: toNumber(this.configService.get<number>('SUM_LABEL', 2)),
            tax_unit: this.configService.get<number>('TAX_UNIT', 6),
        };
    }

    async index(request: PriceRequestDto): Promise<PriceResponseDto> {
        const infoListPromise = request.offer_id ? this.product.infoList(request.offer_id) : Promise.resolve([]);
        const [productsInfos, products] = await Promise.all([infoListPromise, this.product.getPrices(request)]);
        const codes = products.items.map((item) => goodCode(item));
        const [goods, percents] = await Promise.all([
            this.goodService.prices(codes, null),
            this.goodService.getPerc(codes, null),
        ]);
        const percDirectFlow = 1 + this.configService.get<number>('PERC_DIRECT_FLOW', 0) / 100;
        return {
            last_id: products.cursor,
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
                    available_price: 0,
                };
                const productInfo = productsInfos.find((info) => info.sku === item.offer_id);
                const warehouse = this.priceCalculationHelper.selectWarehouse(
                    productInfo?.fboCount || 0,
                    productInfo?.fbsCount || 0,
                    item.commissions.sales_percent_fbo,
                    item.commissions.sales_percent_fbs,
                );

                return {
                    product_id: item.product_id,
                    offer_id: item.offer_id,
                    name: good.name,
                    marketing_price: item.price.marketing_seller_price || 0,
                    marketing_seller_price: item.price.marketing_seller_price,
                    incoming_price: good.price * goodQuantityCoeff(item),
                    available_price: percent.available_price,
                    min_price: item.price.min_price,
                    price: item.price.price,
                    old_price: item.price.old_price,
                    min_perc: percent.min_perc,
                    perc: percent.perc,
                    old_perc: percent.old_perc,
                    adv_perc: percent.adv_perc,
                    sales_percent: this.priceCalculationHelper.getCommission(item.commissions, warehouse),
                    fbs_direct_flow_trans_max_amount: this.priceCalculationHelper.calculateDelivery(
                        item.commissions,
                        warehouse,
                        percDirectFlow,
                    ),
                    auto_action_enabled: item.price.auto_action_enabled,
                    sum_pack: percent.packing_price,
                    fbsCount: productInfo?.fbsCount || 0,
                    fboCount: productInfo?.fboCount || 0,
                    typeId: productInfo?.typeId,
                    volumeWeight: productInfo?.volumeWeight,
                };
            }),
        };
    }
    async update(prices: UpdatePricesDto): Promise<any> {
        return this.product.setPrice(prices);
    }

    async updateVat(offerIds: string[], vat: number): Promise<any> {
        const prices: UpdatePricesDto = {
            prices: offerIds.map(offer_id => ({ offer_id, vat: this.numberToVat(vat), currency_code: 'RUB' }))
        };
        return this.update(prices);
    }
    // @Cron('0 0 0 * * 0', { name: 'updateOzonPrices' })
    async updateAllPrices(level = 0, cursor = '', visibility = ProductVisibility.IN_SALE, limit = 1000): Promise<any> {
        const pricesForObtain = await this.product.getPrices({ limit, cursor, visibility });
        let answer = [];
        if (pricesForObtain.items.length > 0) {
            const res = await this.goodService.updatePriceForService(
                this,
                pricesForObtain.items.map((p) => p.offer_id),
            );
            answer = res.result
                .filter((update: any) => !update.updated)
                .concat(await this.updateAllPrices(level + 1, pricesForObtain.cursor));
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
            taxUnit: toNumber(this.configService.get<number>('TAX_UNIT', 6)),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        const percDirectFlow = 1 + this.configService.get<number>('PERC_DIRECT_FLOW', 0) / 100;
        const allResults: IProductCoeffsable[] = [];

        await this.processPricesBatched(skus, async (items, skusBatch) => {
            const counts = await this.product.infoList(skusBatch);
            for (const product of items) {
                const productInfo = counts.find((info) => info.sku === product.offer_id);
                allResults.push(new OzonProductCoeffsAdapter(product, percDirectFlow, productInfo, this.priceCalculationHelper));
            }
        });

        return allResults;
    }

    private async processPricesBatched(
        skus: string[],
        processor: (items: ProductPriceDto[], skusBatch: string[]) => Promise<void>,
        batchSize = 1000,
    ): Promise<void> {
        for (const skusBatch of chunk(skus, batchSize)) {
            const response = await this.product.getPrices({
                offer_id: skusBatch,
                limit: batchSize,
                visibility: ProductVisibility.IN_SALE,
            });

            if (!response?.items) {
                this.logger.error('Invalid response from Ozon API', { response, skus: skusBatch });
                continue;
            }

            await processor(response.items, skusBatch);
        }
    }

    async updatePrices(updatePrices: UpdatePriceDto[]): Promise<any> {
        return this.update({ prices: updatePrices });
    }

    createAction(): Promise<Excel.Buffer> {
        return Promise.resolve(undefined);
    }

    async getLowPrices(minProfit: number, minPercent: number, count: number): Promise<string[]> {
        const cachedLowPrices = await this.cacheManager.get<string[]>('lowPrices');
        const skus = this.product.skuList.filter((sku) => !cachedLowPrices?.includes(sku));
        const lowPrices: string[] = [];
        const percents: ObtainCoeffsDto = this.getObtainCoeffs();
        for (const offerIdChunk of chunk(skus, count)) {
            const prices: PriceResponseDto = await this.index({
                offer_id: offerIdChunk,
                visibility: ProductVisibility.VISIBLE,
                limit: count,
            });
            for (const price of prices.data) {
                const marketingPrice = toNumber(price.marketing_seller_price);
                const incomingPrice = toNumber(price.incoming_price);
                if (incomingPrice <= 0) continue;
                const payResult = calculatePay(price, percents, marketingPrice);
                const profit = payResult.netProfit !== undefined ? payResult.netProfit : payResult.pay - incomingPrice;

                if (profit < minProfit || (profit / incomingPrice) * 100 < minPercent) {
                    lowPrices.push(price.offer_id);
                    if (lowPrices.length >= count) break;
                }
            }
            if (lowPrices.length >= count) break;
        }
        cachedLowPrices.push(...lowPrices);
        await this.cacheManager.set('lowPrices', cachedLowPrices, 1000 * 60 * 60);
        return lowPrices;
    }

    async checkVatForAll(
        expectedVat: number,
        limit = 1000,
    ): Promise<Array<{ offer_id: string; current_vat: number; expected_vat: number }>> {
        const mismatches: Array<{ offer_id: string; current_vat: number; expected_vat: number }> = [];
        let cursor = '';

        do {
            const page = await this.product.getPrices({ limit, cursor, visibility: ProductVisibility.ALL }); // /v5/product/info/prices
            const items = page?.items ?? [];

            for (const item of items) {
                const currentVat = this.vatToNumber(item?.price?.vat ?? '0'); 
                if (currentVat !== expectedVat) {
                    mismatches.push({ offer_id: item.offer_id, current_vat: currentVat, expected_vat: expectedVat });
                }
            }

            cursor = page?.cursor || '';
        } while (cursor);

        return mismatches;
    }

    /**
     * Загружает комиссии из XLSX файла и сохраняет в Redis
     * XLSX должен содержать колонки: Категория, Тип товара, FBS 100-300, FBO 100-300
     */
    async loadCommissionsFromXlsx(buffer: Buffer): Promise<{ loaded: number }> {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
        const sheet = workbook.worksheets[0];

        // Парсим XLSX: название типа → комиссии
        const xlsxCommissions = new Map<string, OzonCommissionDto>();
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // пропускаем заголовок
            const typeName = row.getCell(2).value?.toString()?.trim();
            const fbo = toNumber(row.getCell(4).value); // FBO 100-300
            const fbs = toNumber(row.getCell(10).value); // FBS 100-300
            if (typeName && (fbo || fbs)) {
                xlsxCommissions.set(typeName.toLowerCase(), { fbs, fbo });
            }
        });

        // Получаем дерево категорий из Ozon API
        const categoryTree = await this.product.getCategoryTree();

        // Связываем type_id с комиссиями по названию
        let loaded = 0;
        const processCategories = (categories: any[]) => {
            for (const category of categories) {
                if (category.type_id && category.type_name) {
                    const commission = xlsxCommissions.get(category.type_name.toLowerCase());
                    if (commission) {
                        this.cacheManager.set(
                            `ozon:commission:${category.type_id}`,
                            JSON.stringify(commission),
                        );
                        loaded++;
                    }
                }
                if (category.children?.length) {
                    processCategories(category.children);
                }
            }
        };
        processCategories(categoryTree.result || []);

        this.logger.log(`Loaded ${loaded} commission records to Redis`);
        return { loaded };
    }

    /**
     * Получает type_id по SKU, кэширует в Redis
     */
    async getTypeId(sku: string): Promise<string | null> {
        const cacheKey = `ozon:type_id:${sku}`;
        const cached = await this.cacheManager.get<string>(cacheKey);
        if (cached) return cached;

        const products = await this.product.infoList([sku]);
        if (!products?.length) return null;

        const typeId = products[0].typeId?.toString();
        if (typeId) {
            await this.cacheManager.set(cacheKey, typeId);
        }
        return typeId;
    }

    /**
     * Получает комиссию из Redis по type_id
     */
    async getCommission(typeId: string): Promise<OzonCommissionDto | null> {
        const cached = await this.cacheManager.get<string>(`ozon:commission:${typeId}`);
        if (!cached) return null;
        return JSON.parse(cached);
    }

    /**
     * Оптимизирует цену Ozon с учётом порогов комиссии
     * Если incoming_price < 150 и min_price > 300, пробует пересчитать с комиссией 100-300
     */
    async optimizeOzonPrice(
        price: IPriceable,
        percents: ObtainCoeffsDto,
        typeId: string,
        useFbo = false,
    ): Promise<UpdatePriceDto> {
        const result1 = calculatePrice(price, percents);

        // Проверка условия оптимизации
        const incomingPrice = toNumber(price.available_price) > 0 ? price.available_price : price.incoming_price;
        if (incomingPrice >= 150 || toNumber(result1.min_price) <= 300) {
            return result1;
        }

        // Получить комиссию 100-300 из Redis
        const commission = await this.getCommission(typeId);
        if (!commission) {
            return result1;
        }

        // Выбрать FBS или FBO
        const newSalesPercent = (useFbo ? commission.fbo : commission.fbs) * 100;

        // Второй расчёт с новой комиссией
        const priceWithNewCommission = { ...price, sales_percent: newSalesPercent };
        const result2 = calculatePrice(priceWithNewCommission, percents);

        // Проверить что result2.min_price <= 300, иначе комиссия 20% не применится
        if (toNumber(result2.min_price) > 300) {
            return result1;
        }

        // Сравнить прибыль
        const profit1 = calculatePay(price, percents, toNumber(result1.min_price));
        const profit2 = calculatePay(priceWithNewCommission, percents, toNumber(result2.min_price));

        // Выбрать лучший вариант
        if (profit2.pay > 0 && profit2.pay > profit1.pay) {
            this.logger.debug(`Optimized price for ${price.offer_id}: ${result1.min_price} -> ${result2.min_price}`);
            return result2;
        }

        return result1;
    }

    /**
     * Загружает PriceDto[] для списка SKU
     */
    async getOzonPrices(skus: string[]): Promise<PriceDto[]> {
        const result: PriceDto[] = [];

        for (const skusBatch of chunk(skus, 1000)) {
            const response = await this.index({
                offer_id: skusBatch,
                limit: skusBatch.length,
                visibility: ProductVisibility.IN_SALE,
            });
            result.push(...response.data);
        }

        return result;
    }
}
