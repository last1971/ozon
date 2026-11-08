import { PricingSnapshot } from '../../helpers/price/price-update.queue';
import { Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { PriceService } from '../../price/price.service';
import { ProductService } from '../../product/product.service';
import { ProductVisibility } from '../../product/product.visibility';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { ozonResultsByOffer } from '../../price/price-update.report';
import { ozonPricesMatch } from '../../helpers/price/ozon-prices-match';
import { PromoSweepService } from '../../promos/price-lever/sweep/promo-sweep.service';
import { JobService } from '../../job/job.service';
import { PromoSweepReport } from '../../promos/price-lever/promo-price.types';
import { LossPriceAdapter, LossPriceResult } from './loss-price.contracts';

@Injectable()
export class OzonLossPriceAdapter implements LossPriceAdapter {
    readonly promoBatchSize = 1000;
    constructor(
        readonly pricing: PriceService,
        private readonly products: ProductService,
        private readonly sweep: PromoSweepService,
        private readonly jobs: JobService,
    ) {}
    offers() {
        return this.products.listAllOfferIds();
    }
    async current(offers: string[]): Promise<Map<string, unknown>> {
        const result = new Map<string, unknown>();
        for (const part of chunk(offers, 1000)) {
            const response = await this.products.getPrices({
                offer_id: part,
                visibility: ProductVisibility.ALL,
                limit: part.length,
            });
            if (!Array.isArray(response?.items)) throw new Error('Ozon не вернул текущие цены');
            for (const item of response.items) result.set(item.offer_id, item.price);
        }
        return result;
    }
    matches(target: UpdatePriceDto, actual: unknown) {
        return ozonPricesMatch(target, actual, 0);
    }
    async persist(_targets: UpdatePriceDto[]) {}
    async send(targets: UpdatePriceDto[]) {
        const response = ozonResultsByOffer(await this.pricing.updatePrices(targets));
        return new Map(
            targets.map((t): [string, LossPriceResult] => {
                const row = response.get(t.offer_id);
                return [
                    t.offer_id,
                    row?.updated
                        ? null
                        : {
                              message:
                                  row?.errors?.map((e) => e.message || e.code).join('; ') ||
                                  'Ozon не подтвердил приём цены',
                              kind: row ? 'data' : 'temporary',
                          },
                ];
            }),
        );
    }
    async promos(offers: string[], snapshots?: Map<string, PricingSnapshot>) {
        const job = snapshots
            ? this.sweep.start(true, 'min', 'loss-queue', offers, snapshots)
            : this.sweep.start(true, 'min', 'loss-queue', offers);
        const state = await this.jobs.whenDone(job.id);
        if (state.status !== 'done') throw new Error(state.error || 'Сверка акций Ozon не завершена');
        const report = state.result as PromoSweepReport;
        if (report.checked !== offers.length) throw new Error('Неполная сверка акций Ozon');
        const items = new Map(report.items.map((i) => [i.offerId, i]));
        return new Map(
            offers.map((offer): [string, LossPriceResult] => {
                const item = items.get(offer);
                return [
                    offer,
                    item && (!item.ok || item.applied === false)
                        ? {
                              message: item.notes.join('; ') || 'Акции Ozon не приведены к новой цене',
                              kind: item.ok ? 'temporary' : 'data',
                          }
                        : null,
                ];
            }),
        );
    }
}
