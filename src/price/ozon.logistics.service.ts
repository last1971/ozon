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
    returnFlow: number;
}

/** Источник расходов для этапа 6. Не выбирает цену и ничего не отправляет на Ozon. */
@Injectable()
export class OzonLogisticsService {
    private readonly logger = new Logger(OzonLogisticsService.name);
    private readonly pending = new Map<string, Promise<any>>();
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

    async quote(product: ProductPriceDto, info: ProductInfoDto) {
        if (product.offer_id !== info.sku) throw new Error('Артикул цены не совпадает с карточкой');
        const minUnits = Number(this.config.get('OZON_LOGISTICS_MIN_UNITS', 1));
        if (!Number.isSafeInteger(minUnits) || minUnits < 1)
            throw new Error('OZON_LOGISTICS_MIN_UNITS должен быть целым >= 1');
        const money = (value: unknown, name: string): number => {
            if (value === null || value === undefined || value === '') throw new Error(`Нет ${name} в API Ozon`);
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) throw new Error(`Некорректный ${name} в API Ozon`);
            return n;
        };
        let history: OzonRoutesSnapshot | null = null,
            historyError: string | undefined;
        try {
            history = await this.routes.get();
        } catch (e) {
            historyError = 'Не удалось прочитать распределение направлений';
            this.logger.warn(`${product.offer_id}: ${historyError}: ${e.message}`);
        }
        const tariff = await this.tariffs.logistics(info.volumeWeight ?? product.volume_weight);
        const acquiringAmount = money(product.acquiring, 'эквайринг');
        const acquiringReferencePrice = money(product.price.price, 'цена для эквайринга');
        if (acquiringReferencePrice <= 0 && acquiringAmount > 0)
            throw new Error('Нет положительной цены для ставки эквайринга');
        const commissions = product.commissions;
        const schemes: { fbs?: OzonSchemeLogistics; fbo?: OzonSchemeLogistics } = {};
        for (const scheme of ['fbs', 'fbo'] as OzonScheme[]) {
            if (scheme === 'fbo' && !(info.fboCount > 0)) continue;
            let origins = [{ cluster: 'Новосибирск', units: 1 }],
                unavailable = historyError;
            if (scheme === 'fbo') {
                try {
                    const stocks = await this.cached(`stocks:${encodeURIComponent(info.sku)}`, 300_000, () =>
                        this.products.fboStocks([info.sku]),
                    );
                    const clusters = await this.cached('clusters', 86400_000, () => this.products.ozonClusters());
                    origins = fboOrigins(info.sku, stocks, clusters);
                } catch (e) {
                    origins = [];
                    unavailable = 'Не удалось определить склады FBO с остатком';
                    this.logger.warn(`${info.sku}: ${unavailable}: ${e.message}`);
                }
            }
            const directions = history ? selectOzonRoutes(history, scheme, info.sku, info.typeId, minUnits) : null;
            const bands = weightedOzonLogistics(
                tariff,
                directions,
                origins,
                {
                    min: commissions[`${scheme}_direct_flow_trans_min_amount`],
                    max: commissions[`${scheme}_direct_flow_trans_max_amount`],
                },
                unavailable,
            );
            for (const warning of new Set(bands.map((b) => b.warning).filter(Boolean)))
                this.logger.warn(`${info.sku}/${scheme}: ${warning}`);
            schemes[scheme] = {
                bands,
                historySource: directions?.scope ?? 'none',
                lastMile: money(commissions[`${scheme}_deliv_to_customer_amount`], 'последняя миля'),
                firstMile: scheme === 'fbs' ? money(commissions.fbs_first_mile_max_amount, 'обработка FBS') : 0,
                returnFlow: money(commissions[`${scheme}_return_flow_amount`], 'обратная логистика'),
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
