import { PricingDataError } from '../helpers/price/pricing-error';
import { LossPricingService, LossPricingStatistics } from '../marketplace-loss/loss-pricing.service';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OzonCategoryService } from '../ozon.category/ozon.category.service';
import { OzonLogisticsService } from './ozon.logistics.service';
import { ProductPriceDto } from './dto/product.price.dto';
import { ProductInfoDto } from '../product/dto/product.info.dto';
import { OzonPricingContext, OzonPriceScheme } from '../helpers/price/ozon.pricing';

/** Собирает актуальные входы. Выбор цены и формула прибыли остаются чистыми функциями. */
@Injectable()
export class OzonPricingService {
    private readonly lossSnapshots = new WeakMap<ProductInfoDto, LossPricingStatistics | undefined>();
    constructor(
        private readonly categories: OzonCategoryService,
        private readonly logistics: OzonLogisticsService,
        private readonly config: ConfigService,
        private readonly losses: LossPricingService,
    ) {}

    async prepare(infos: ProductInfoDto[]) {
        const [, statistics] = await Promise.all([
            this.logistics.prepare(infos),
            this.losses.load(
                'OZON',
                infos.map((info) => info.sku),
            ),
        ]);
        for (const info of infos) this.lossSnapshots.set(info, statistics.get(info.sku));
    }

    async load(product: ProductPriceDto, info: ProductInfoDto): Promise<OzonPricingContext> {
        if (!info || info.sku !== product.offer_id || !info.typeId)
            throw new PricingDataError(`${product.offer_id}: нет карточки или типа Ozon`);
        const commissions = await this.categories.getCommissions(info.typeId);
        if (!commissions) throw new PricingDataError(`${product.offer_id}: нет импортированных комиссий Ozon`);
        const quote = await this.logistics.quote(product, info);
        const schemes: OzonPriceScheme[] = [];
        for (const scheme of ['fbs', 'fbo'] as const) {
            if (!(info[scheme === 'fbs' ? 'fbsCount' : 'fboCount'] > 0)) continue;
            const costs = quote[scheme];
            if (!costs) throw new PricingDataError(`${product.offer_id}: нет расходов ${scheme}`);
            schemes.push({
                scheme,
                commissions: commissions[scheme].map((r) => ({
                    ...r,
                    minIncluded: r.minIncluded !== false,
                    maxIncluded: r.maxIncluded === true,
                })),
                logistics: costs.bands,
                lastMile: costs.lastMile,
                firstMile: costs.firstMile,
                returnFlow: costs.returnFlow,
            });
        }
        const statistics = this.lossSnapshots.has(info)
            ? this.lossSnapshots.get(info)
            : (await this.losses.load('OZON', [product.offer_id])).get(product.offer_id);
        const warnings = [
            ...new Set(schemes.flatMap((scheme) => scheme.logistics.map((band) => band.warning).filter(Boolean))),
        ];
        return {
            ...(warnings.length ? { warnings } : {}),
            ...(statistics ? { lossStatistics: statistics } : {}),
            schemes,
            acquiringRate: quote.acquiringRate,
            minProfitRub: Number(this.config.get('MIN_PROFIT_RUB', 20)),
            minMarkupPercent: Number(this.config.get('MIN_PROFIT_PERC', 10)),
            vatRate: Number(this.config.get('VAT_RATE', 20)),
            profitTaxRate: Number(this.config.get('PROFIT_TAX_RATE', 20)),
        };
    }
}
