import { Injectable } from '@nestjs/common';
import { LossStatsStore } from './loss-stats.store';
import { lossExpensesPerSale } from './loss-expenses';
import { lossOfferKey } from '../helpers/price/marketplace.loss.stats';
import { MarketplaceLossCostsInput } from '../helpers/price/marketplace.loss.costs';

export type LossPricingStatistics = Omit<MarketplaceLossCostsInput, 'purchaseCost'>;
/** Только чтение своего снимка. Никакого выбора категории, подстановки Ozon или копии формулы. */
@Injectable()
export class LossPricingService {
    constructor(private readonly store: LossStatsStore) {}
    async load(service: string, offers: string[]): Promise<Map<string, LossPricingStatistics>> {
        const result = new Map<string, LossPricingStatistics>();
        if (!offers.length) return result;
        const snapshot = await this.store.read(service);
        const rows = new Map((snapshot?.rows ?? []).map((row) => [lossOfferKey(row.offerId), row]));
        for (const offer of offers) {
            const row = rows.get(lossOfferKey(offer));
            const statistics = row && lossExpensesPerSale(row);
            result.set(
                offer,
                statistics ?? {
                    // Известный брак сохраняется и в старом снимке без финансовых сумм.
                    defectRate: row?.defectRate ?? null,
                    confirmedDefectCompensation: 0,
                    ...(service === 'OZON' ? {} : { paidReturnDelivery: null }),
                    cancellationDelivery: null,
                    sellerReturnDelivery: null,
                },
            );
        }
        return result;
    }
}
