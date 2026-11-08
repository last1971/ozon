import { PricingDataError } from '../helpers/price/pricing-error';
import { pricingWarning } from '../helpers/price/pricing-warnings';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { OzonTariffService } from '../ozon.category/tariff.service';
import { ProductService } from '../product/product.service';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { ProductPriceDto } from './dto/product.price.dto';
import { OzonRoutesService } from './ozon.routes.service';
import { OzonRoutesSnapshot, OzonScheme, selectOzonRoutes } from '../helpers/price/ozon.routes';
import { fboOrigins, LogisticsCostBand, weightedOzonLogistics } from '../helpers/price/ozon.logistics';

export interface OzonSchemeLogistics {
    bands: LogisticsCostBand[];
    historySource: 'offer' | 'type' | 'cabinet' | 'none';
    lastMile: number;
    firstMile: number;
    returnFlow: number | null;
}

/** Источник расходов для этапа 6. Не выбирает цену и ничего не отправляет на Ozon. */
@Injectable()
export class OzonLogisticsService {
    private readonly logger = new Logger(OzonLogisticsService.name);
    private readonly pending = new Map<string, Promise<any>>();
    private readonly stockFailures = new Map<string, { until: number; error: Error }>();
    constructor(
        private readonly routes: OzonRoutesService,
        private readonly tariffs: OzonTariffService,
        private readonly products: ProductService,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        private readonly config: ConfigService,
    ) {}

    private async cached<T>(suffix: string, ttl: number, load: () => Promise<T>): Promise<T> {
        const key = `${this.routes.cacheKey}:${suffix}`;
        const current = await this.cache.get<T>(key);
        if (current !== undefined && current !== null) return current;
        if (!this.pending.has(key)) {
            this.pending.set(
                key,
                load()
                    .then(async (value) => {
                        await this.cache.set(key, value, ttl);
                        return value;
                    })
                    .finally(() => this.pending.delete(key)),
            );
        }
        return this.pending.get(key);
    }

    /** Наполняет тот же кеш, который читает quote; запросы остаются в ProductService.fboStocks. */
    async prepare(infos: ProductInfoDto[]): Promise<void> {
        const offers: string[] = [];
        for (const info of infos) {
            if (!(info.fboCount > 0)) continue;
            const cached = await this.cache.get(`${this.routes.cacheKey}:stocks:${encodeURIComponent(info.sku)}`);
            const failed = this.stockFailures.get(info.sku);
            if (failed && failed.until <= Date.now()) this.stockFailures.delete(info.sku);
            if (cached == null && !(failed?.until > Date.now())) offers.push(info.sku);
        }
        if (!offers.length) return;
        try {
            const stocks = await this.products.fboStocks([...new Set(offers)]);
            for (const offer of offers) {
                await this.cache.set(
                    `${this.routes.cacheKey}:stocks:${encodeURIComponent(offer)}`,
                    stocks.filter((s) => s.offer_id === offer),
                    300_000,
                );
                this.stockFailures.delete(offer);
            }
        } catch (error) {
            // После отказа пачки не повторяем её отдельно для каждого товара.
            for (const offer of offers) this.stockFailures.set(offer, { until: Date.now() + 30_000, error });
        }
    }

    private warn(message: string, offer: string) {
        pricingWarning(message, offer, (text) => this.logger.warn(text));
    }

    async quote(product: ProductPriceDto, info: ProductInfoDto) {
        if (product.offer_id !== info.sku) throw new PricingDataError('Артикул цены не совпадает с карточкой');
        const minUnits = Number(this.config.get('OZON_LOGISTICS_MIN_UNITS', 1));
        if (!Number.isSafeInteger(minUnits) || minUnits < 1)
            throw new PricingDataError('OZON_LOGISTICS_MIN_UNITS должен быть целым >= 1');
        const money = (value: unknown, name: string): number => {
            if (value === null || value === undefined || value === '')
                throw new PricingDataError(`Нет ${name} в API Ozon`);
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) throw new PricingDataError(`Некорректный ${name} в API Ozon`);
            return n;
        };
        let history: OzonRoutesSnapshot;
        try {
            history = await this.routes.get();
        } catch (e) {
            throw new Error(`Не удалось прочитать распределение направлений для доставки: ${e.message}`);
        }
        const tariff = await this.tariffs.logistics(info.volumeWeight ?? product.volume_weight);
        const acquiringAmount = money(product.acquiring, 'эквайринг');
        const acquiringReferencePrice = money(product.price.price, 'цена для эквайринга');
        if (acquiringReferencePrice <= 0 && acquiringAmount > 0)
            throw new PricingDataError('Нет положительной цены для ставки эквайринга');
        const commissions = product.commissions;
        const schemes: { fbs?: OzonSchemeLogistics; fbo?: OzonSchemeLogistics } = {};
        for (const scheme of ['fbs', 'fbo'] as OzonScheme[]) {
            if (!(info[scheme === 'fbs' ? 'fbsCount' : 'fboCount'] > 0)) continue;
            let origins = [{ cluster: 'Новосибирск', units: 1 }];
            if (scheme === 'fbo') {
                try {
                    const failure = this.stockFailures.get(info.sku);
                    if (failure?.until > Date.now()) throw failure.error;
                    this.stockFailures.delete(info.sku);
                    const stocks = await this.cached(`stocks:${encodeURIComponent(info.sku)}`, 300_000, () =>
                        this.products.fboStocks([info.sku]),
                    );
                    const clusters = await this.cached('clusters:ozon-cis', 86400_000, () =>
                        this.products.ozonClusters(),
                    );
                    origins = fboOrigins(info.sku, stocks, clusters);
                } catch (e) {
                    const message = `Не удалось определить склады FBO с остатком для доставки: ${e.message}`;
                    throw e instanceof PricingDataError ? new PricingDataError(message) : new Error(message);
                }
            }
            const directions = selectOzonRoutes(history, scheme, info.sku, info.typeId, minUnits);
            const bands = weightedOzonLogistics(tariff, directions, origins);
            for (const warning of new Set(bands.map((b) => b.warning).filter(Boolean)))
                this.warn(warning, `${info.sku}/${scheme}`);
            const returnFlow: unknown = commissions[`${scheme}_return_flow_amount`];
            schemes[scheme] = {
                bands,
                historySource: directions?.scope ?? 'none',
                lastMile: money(commissions[`${scheme}_deliv_to_customer_amount`], 'последняя миля'),
                firstMile: scheme === 'fbs' ? money(commissions.fbs_first_mile_max_amount, 'обработка FBS') : 0,
                returnFlow: returnFlow == null || returnFlow === '' ? null : money(returnFlow, 'обратная логистика'),
            };
        }
        return {
            ...schemes,
            acquiringAmount,
            acquiringReferencePrice,
            acquiringRate: acquiringReferencePrice > 0 ? acquiringAmount / acquiringReferencePrice : 0,
            tariffRevision: tariff.revision,
            historyFrom: history?.from ?? null,
            historyTo: history?.to ?? null,
        };
    }
}
