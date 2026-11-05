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
    constructor(
        private readonly categories: OzonCategoryService,
        private readonly logistics: OzonLogisticsService,
        private readonly config: ConfigService,
    ) {}

    async load(product: ProductPriceDto, info: ProductInfoDto): Promise<OzonPricingContext> {
        if (!info || info.sku !== product.offer_id || !info.typeId)
            throw new Error(`${product.offer_id}: нет карточки или типа Ozon`);
        const commissions = await this.categories.getCommissions(info.typeId);
        if (!commissions) throw new Error(`${product.offer_id}: нет импортированных комиссий Ozon`);
        const quote = await this.logistics.quote(product, info);
        const schemes: OzonPriceScheme[] = [];
        for (const scheme of ['fbs', 'fbo'] as const) {
            if (!(info[scheme === 'fbs' ? 'fbsCount' : 'fboCount'] > 0)) continue;
            const costs = quote[scheme];
            if (!costs) throw new Error(`${product.offer_id}: нет расходов ${scheme}`);
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
        return {
            schemes,
            acquiringRate: quote.acquiringRate,
            minProfitRub: Number(this.config.get('MIN_PROFIT_RUB', 20)),
            minMarkupPercent: Number(this.config.get('MIN_PROFIT_PERC', 10)),
            vatRate: Number(this.config.get('VAT_RATE', 20)),
            profitTaxRate: Number(this.config.get('PROFIT_TAX_RATE', 20)),
        };
    }
}
