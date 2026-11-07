import { BadRequestException, Injectable } from '@nestjs/common';
import { LossStatsStore } from './loss-stats.store';
import { PriceService } from '../price/price.service';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { ProductService } from '../product/product.service';
import { lossOfferKey } from '../helpers/price/marketplace.loss.stats';
import { lossExpensesPerSale } from './loss-expenses';
import { lossPriceFields } from '../helpers/price/marketplace.loss.input';
import { calculateMarketplaceLossCosts, MarketplaceLossCosts } from '../helpers/price/marketplace.loss.costs';
import { goodCode, goodQuantityCoeff } from '../helpers/product/product.helpers';

export interface LossCostReport {
    offerId: string;
    calculatedAt?: Date;
    costs: Omit<MarketplaceLossCosts, 'total'> | null;
    price?: number;
    scheme?: string;
    error?: string;
}
/** Представление сохранённого снимка. Формулы и выбор процентов принадлежат существующим калькуляторам. */
@Injectable()
export class LossReportService {
    constructor(
        private readonly store: LossStatsStore,
        private readonly prices: PriceService,
        private readonly goods: Trade2006GoodService,
        private readonly products: ProductService,
    ) {}
    read(service: string) {
        return this.store.read(service);
    }
    async costs(service: string, offerId: string): Promise<LossCostReport> {
        let key: string;
        try {
            key = lossOfferKey(offerId);
        } catch {
            throw new BadRequestException('Некорректный артикул');
        }
        const snapshot = await this.read(service);
        const row = snapshot?.rows.find((r) => lossOfferKey(r.offerId) === key);
        const empty: LossCostReport = { offerId: key, calculatedAt: snapshot?.calculatedAt, costs: null };
        try {
            if (!row) throw new Error('Для товара нет сохранённой статистики');
            if (!row.expenses) throw new Error('Расходы ещё не рассчитаны. Нужен пересчёт статистики');
            if (!(row.soldUnits > 0)) throw new Error('Нет продаж за период: расходы на одну продажу неизвестны');
            if (service === 'OZON') {
                // Снимок объединяет 123 и 123-1; запрос цены использует реальный артикул каталога.
                const offers = await this.products.listAllOfferIds();
                const actual = offers.find((offer) => {
                    try {
                        return lossOfferKey(offer) === key;
                    } catch {
                        return false;
                    }
                });
                if (!actual) throw new Error('Нет карточки Ozon');
                const result = await this.prices.getOzonPricingResult(actual);
                if (result.error || !result.costs || !result.min)
                    throw new Error(result.error || 'Нет результата расчёта Ozon');
                const c = result.costs;
                if (
                    [c.returns, c.cancellations, c.sellerReturns, c.defects, c.defectCompensation].some(
                        (value) => typeof value !== 'number' || !Number.isFinite(value),
                    )
                )
                    throw new Error('Расчёт Ozon не содержит полных расходов на потери');
                return {
                    ...empty,
                    price: result.min.price,
                    scheme: result.min.scheme,
                    costs: {
                        returns: c.returns,
                        cancellations: c.cancellations,
                        sellerReturns: c.sellerReturns,
                        defects: c.defects,
                        defectCompensation: c.defectCompensation,
                    },
                };
            }
            const statistics = lossExpensesPerSale(row);
            if (statistics.paidReturnDelivery === undefined)
                throw new Error('Нет собственных расходов доставки возвратов этой площадки');
            const offer_id = key;
            const code = goodCode({ offer_id });
            const goods = await this.goods.prices([code], null);
            const { lossCosts } = lossPriceFields(
                statistics,
                goods.find((g) => String(g.code) === code),
                goodQuantityCoeff({ offer_id }),
            );
            return { ...empty, costs: calculateMarketplaceLossCosts(lossCosts, 0) };
        } catch (error) {
            return { ...empty, error: error.message };
        }
    }
}
