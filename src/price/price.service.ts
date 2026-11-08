import { lossPriceFields, productLossPriceFields } from '../helpers/price/marketplace.loss.input';
import { BulkPriceJobService } from './bulk/bulk-price-job.service';
import { SerializePriceUpdate } from '../helpers/price/price-update.queue';
import { OzonPricingResultDto, OzonPricingPreviewDto } from './dto/ozon-pricing-result.dto';
import {
    calculateOzonPrices,
    evaluateOzonPrice,
    ozonDeadZoneFloor,
    OzonPriceEvaluation,
} from '../helpers/price/ozon.pricing';
import { ozonPricingInput } from '../helpers/price/ozon.pricing.input';
import { completePricePercents } from '../helpers/price/price.percents';
import { OzonPricingService } from './ozon.pricing.service';
import { ozonReturnPriceFields } from '../helpers/price/ozon.return.perc';
import { resolvePriceBase } from '../helpers/price/price.base';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from './dto/price.request.dto';
import { PricePresetDto } from './dto/price.preset.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { PriceResponseDto } from './dto/price.response.dto';
import { PriceDto } from './dto/price.dto';
import { calculatePay, calculatePrice, goodCode, goodQuantityCoeff, numberToVat } from '../helpers';
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
import { OzonCategoryService } from '../ozon.category/ozon.category.service';

@Injectable()
export class PriceService implements IPriceUpdateable, IVatUpdateable {
    readonly priceUpdateKey = 'ozon';
    @Inject(BulkPriceJobService) private readonly bulk: BulkPriceJobService;
    private logger = new Logger(PriceService.name);
    constructor(
        private product: ProductService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private configService: ConfigService,
        private cacheManager: Cache,
        private priceCalculationHelper: PriceCalculationHelper,
        private ozonCategoryService: OzonCategoryService,
        private readonly ozonPricing: OzonPricingService,
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
    numberToVat(vat: number): string {
        return numberToVat(vat);
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
        if (!request.offer_id && products.items.length)
            productsInfos.push(...(await this.product.infoList(products.items.map((item) => item.offer_id))));
        const codes = products.items.map((item) => goodCode(item));
        const [goods, percents] = await Promise.all([
            this.goodService.prices(codes, null),
            this.goodService.getPerc(codes, null),
        ]);
        await completePricePercents(
            products.items.map((item) => item.offer_id),
            this.goodService,
            { goods, percents },
        );
        await this.ozonPricing.prepare(productsInfos);
        const percDirectFlow = 1 + this.configService.get<number>('PERC_DIRECT_FLOW', 0) / 100;
        const data: PriceDto[] = [];
        for (const item of products.items) {
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
            const base = resolvePriceBase(item.offer_id, goodQuantityCoeff(item), good, percent);
            const productInfo = productsInfos.find((info) => info.sku === item.offer_id);
            const adapter = new OzonProductCoeffsAdapter(
                item,
                percDirectFlow,
                productInfo,
                this.priceCalculationHelper,
                await this.ozonPricing.load(item, productInfo),
            );

            data.push({
                ...ozonReturnPriceFields(adapter, percent.return_perc),
                ...productLossPriceFields(adapter, goods),
                fbs_return_flow_amount: item.commissions.fbs_return_flow_amount,
                fbo_return_flow_amount: item.commissions.fbo_return_flow_amount,
                product_id: item.product_id,
                offer_id: item.offer_id,
                name: good?.name,
                marketing_price: item.price.marketing_seller_price || 0,
                marketing_seller_price: item.price.marketing_seller_price,
                incoming_price: base.incoming_price,
                base_source: base.base_source,
                available_price: base.available_price,
                min_price: item.price.min_price,
                price: item.price.price,
                old_price: item.price.old_price,
                min_perc: percent.min_perc ?? this.configService.get<number>('PERC_MIN', 15),
                perc: percent.perc ?? this.configService.get<number>('PERC_NOR', 25),
                old_perc: percent.old_perc ?? this.configService.get<number>('PERC_MAX', 50),
                adv_perc: percent.adv_perc ?? 0,
                sales_percent: adapter.getSalesPercent(),
                fbs_direct_flow_trans_max_amount: adapter.getTransMaxAmount(),
                auto_action_enabled: item.price.auto_action_enabled,
                sum_pack: percent.packing_price ?? this.configService.get<number>('SUM_PACK', 10),
                fbsCount: productInfo?.fbsCount || 0,
                fboCount: productInfo?.fboCount || 0,
                typeId: productInfo?.typeId,
                volumeWeight: productInfo?.volumeWeight,
                marketing_actions: item.marketing_actions?.actions ?? [],
            });
        }
        return { last_id: products.cursor, data };
    }
    /** Отдельный результат единой формулы; цены Ozon и наценки в БД не изменяются. */
    async getOzonPricingResult(offerId: string, preview: OzonPricingPreviewDto = {}): Promise<OzonPricingResultDto> {
        const known = Object.assign(new OzonPricingResultDto(), { offerId });
        const current = (value: unknown) =>
            value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
        try {
            const code = goodCode({ offer_id: offerId });
            const pieces = goodQuantityCoeff({ offer_id: offerId });
            const [prices, infos, goods, percents] = await Promise.all([
                this.product.getPrices({ offer_id: [offerId], visibility: ProductVisibility.ALL, limit: 1 }),
                this.product.infoList([offerId]),
                this.goodService.prices([code], null),
                this.goodService.getPerc([code], null),
            ]);
            const product = prices?.items?.find((p) => p.offer_id === offerId);
            const info = infos?.find((p) => p.sku === offerId);
            if (product) {
                known.current = {
                    min: current(product.price.min_price),
                    normal: current(product.price.price),
                    max: current(product.price.old_price),
                };
            }
            if (!product || !info) throw new Error('Нет карточки Ozon');
            await completePricePercents([offerId], this.goodService, { goods, percents });
            const saved = percents.find((p) => String(p.offer_id) === code && Number(p.pieces ?? 1) === pieces);
            if (!saved) throw new Error('Нет базы или наценок для расчёта');
            const percent = { ...saved };
            let previewError: Error | undefined;
            for (const key of ['min_perc', 'perc', 'old_perc', 'adv_perc', 'sum_pack', 'available_price'] as const) {
                if (preview[key] === undefined) continue;
                const value = Number(preview[key]);
                if (!Number.isFinite(value) || value < 0) {
                    previewError = new Error(`Некорректное значение ${key}`);
                    break;
                }
                percent[key === 'sum_pack' ? 'packing_price' : key] = value;
            }
            const base = resolvePriceBase(
                offerId,
                pieces,
                goods.find((g) => String(g.code) === code),
                percent,
            );
            // Ошибка другого поля не уничтожает уже прочитанную базу и снимок текущих цен.
            known.base = base.incoming_price ?? 0;
            known.baseSource = base.base_source;
            if (previewError) throw previewError;
            if (base.base_source === 'none') throw new Error('Нет базы себестоимости');
            await this.ozonPricing.prepare([info]);
            const ozon = await this.ozonPricing.load(product, info);
            if (ozon.warnings?.length) known.warnings = ozon.warnings;
            const input = ozonPricingInput(
                {
                    ...base,
                    ...lossPriceFields(
                        ozon.lossStatistics,
                        goods.find((g) => String(g.code) === code),
                        pieces,
                    ),
                    ozon,
                    offer_id: offerId,
                    min_perc: percent.min_perc,
                    perc: percent.perc,
                    old_perc: percent.old_perc,
                    adv_perc: percent.adv_perc ?? 0,
                    sum_pack: percent.packing_price ?? Number(this.configService.get('SUM_PACK', 10)),
                    return_perc: saved.return_perc ?? 0,
                    sales_percent: 0,
                    fbs_direct_flow_trans_max_amount: 0,
                },
                this.getObtainCoeffs(),
            );
            const result = calculateOzonPrices(input);
            const level = (r: OzonPriceEvaluation & { targetProfit: number }, requestedMarkup: number) => ({
                price: r.salePrice,
                profit: r.profit,
                scheme: r.scheme,
                commissionRate: r.commissionBand.rate,
                profitPercent: (r.profit / input.base) * 100,
                requestedMarkup,
                appliedMarkup: (r.targetProfit / input.base) * 100,
                targetProfit: r.targetProfit,
            });
            const { base: unusedBase, ...costs } = result.min.costs;
            const buyerPrice = current(product.price.marketing_seller_price);
            let buyer: OzonPricingResultDto['buyer'];
            if (buyerPrice !== null) {
                const evaluated = evaluateOzonPrice(input, buyerPrice);
                buyer = {
                    price: buyerPrice,
                    profit: evaluated.profit,
                    profitPercent: (evaluated.profit / input.base) * 100,
                };
            }
            const hasLower = input.schemes.some((s) => [...s.commissions, ...s.logistics].some((b) => b.max === 300));
            let lowerBand: OzonPricingResultDto['lowerBand'];
            if (hasLower) {
                let profit: number | null = null;
                try {
                    profit = evaluateOzonPrice(input, 300).profit;
                } catch {
                    /* Нет общего тарифа на границе. */
                }
                lowerBand = {
                    ceiling: 300,
                    profit,
                    targetProfit: result.min.targetProfit,
                    eligible: result.min.candidates.some((c) => c.salePrice <= 300),
                };
            }
            const scheme = input.schemes.find((s) => s.scheme === result.min.scheme);
            const delivery = scheme.logistics.find(
                (b) => b.min === result.min.logisticsBand.min && b.max === result.min.logisticsBand.max,
            );
            return {
                offerId,
                limits: { minProfitRub: input.minProfitRub, minMarkupPercent: input.minMarkupPercent },
                buyer,
                ...(known.warnings ? { warnings: known.warnings } : {}),
                lowerBand,
                costSources: {
                    commission: 'XLSX комиссий',
                    delivery:
                        delivery?.source === 'category-average'
                            ? 'XLSX логистики и история направлений категории'
                            : 'XLSX логистики и история направлений',
                    firstMile: 'API Ozon',
                    lastMile: 'API Ozon',
                    acquiring: 'API Ozon',
                    advertising: 'Настройка товара',
                    packing: 'Настройка товара',
                    label: 'Настройка сервера',
                    handling: 'Настройка сервера',
                    returns: 'История возвратов и тарифы доставки',
                    tax: 'Настройка сервера',
                    vat: 'Настройка сервера',
                    profitTax: 'Настройка сервера',
                },
                baseSource: base.base_source,
                base: input.base,
                min: level(result.min, input.markups.min),
                normal: level(result.normal, input.markups.normal),
                max: level(result.max, input.markups.max),
                costs,
                current: known.current,
                deadZoneFloor: ozonDeadZoneFloor(input, result),
            };
        } catch (e) {
            return { ...known, error: e instanceof Error ? e.message : String(e) };
        }
    }

    @SerializePriceUpdate('ozon')
    async update(prices: UpdatePricesDto): Promise<any> {
        return this.product.setPrice(prices);
    }

    async updateVat(offerIds: string[], vat: number): Promise<any> {
        const prices: UpdatePricesDto = {
            prices: offerIds.map((offer_id) => ({ offer_id, vat: this.numberToVat(vat), currency_code: 'RUB' })),
        };
        return this.update(prices);
    }
    // @Cron('0 0 0 * * 0', { name: 'updateOzonPrices' })
    startUpdateAllPrices(clientId?: string) {
        return this.bulk.start(
            {
                market: 'ozon',
                page: async (cursor) => {
                    const page = await this.product.getPrices({
                        limit: 1000,
                        cursor,
                        visibility: ProductVisibility.IN_SALE,
                    });
                    if (!Array.isArray(page?.items)) throw new Error('Не удалось загрузить каталог Ozon');
                    return {
                        offers: page.items.map((p) => p.offer_id),
                        next: page.items.length ? page.cursor : undefined,
                    };
                },
                update: (offers) => this.goodService.repriceForService(this, offers),
            },
            clientId,
        );
    }

    async updateAllPrices() {
        return this.bulk.wait(this.startUpdateAllPrices().id);
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
            await this.ozonPricing.prepare(counts);
            for (const product of items) {
                const productInfo = counts.find((info) => info.sku === product.offer_id);
                allResults.push(
                    new OzonProductCoeffsAdapter(
                        product,
                        percDirectFlow,
                        productInfo,
                        this.priceCalculationHelper,
                        await this.ozonPricing.load(product, productInfo),
                    ),
                );
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
                visibility: ProductVisibility.ALL,
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
     * Получает комиссию 100-300 из БД по type_id
     * Возвращает формат {fbo, fbs} для обратной совместимости
     */
    async getCommission(typeId: string): Promise<OzonCommissionDto | null> {
        const commissions = await this.ozonCategoryService.getCommissions(Number(typeId));
        if (!commissions) return null;

        // Возвращаем комиссию для диапазона 100-300 (index 1)
        const fboRange = commissions.fbo.find((r) => r.min === 100 && r.max === 300);
        const fbsRange = commissions.fbs.find((r) => r.min === 100 && r.max === 300);

        if (!fboRange || !fbsRange) return null;
        return { fbo: fboRange.rate, fbs: fbsRange.rate };
    }

    /** Свежие ставки сервера для ручного расчёта; тарифам из браузера не доверяем. */
    async withOzonPricing(price: IPriceable): Promise<IPriceable> {
        const products = await this.getProductsWithCoeffs([price.offer_id]);
        const product = products.find((p) => p.getSku() === price.offer_id);
        if (!product) throw new BadRequestException(`${price.offer_id}: Ozon не вернул товар по этому артикулу`);
        const ozon = product.getOzonPricing?.();
        if (!ozon) throw new BadRequestException(`${price.offer_id}: для товара нет данных расчёта Ozon`);
        const statistics = await this.goodService.getPerc([goodCode(price)], null);
        const own = statistics.find(
            (p) => String(p.offer_id) === goodCode(price) && p.pieces === goodQuantityCoeff(price),
        );
        // Данные потерь из браузера не принимаем; закупку читаем только с сервера.
        const lossGoods = ozon.lossStatistics ? await this.goodService.prices([goodCode(price)], null) : [];
        return {
            ...price,
            lossCosts: undefined,
            ...productLossPriceFields(product, lossGoods),
            ...ozonReturnPriceFields(product, own?.return_perc ?? 0),
            ozon,
        };
    }

    /** Совместимая точка входа: единый расчёт всех ступеней и схем с остатком. */
    async optimizeOzonPrice(
        price: IPriceable,
        percents: ObtainCoeffsDto,
        typeId: string,
        useFbo = false,
    ): Promise<UpdatePriceDto> {
        if (price.base_source === 'none') return null;
        return calculatePrice(await this.withOzonPricing(price), this.getObtainCoeffs());
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
