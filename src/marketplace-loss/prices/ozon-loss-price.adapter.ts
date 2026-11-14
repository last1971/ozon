import { setJobActivity } from '../../job/job.execution';
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
import { PromoPriceService } from '../../promos/price-lever/promo-price.service';
import { ProductPriceDto } from '../../price/dto/product.price.dto';
import { ozonPromoPricesMatch } from './ozon-promo-prices-match';

@Injectable()
export class OzonLossPriceAdapter implements LossPriceAdapter {
    readonly promoBatchSize = 1000;
    constructor(
        readonly pricing: PriceService,
        private readonly products: ProductService,
        private readonly sweep: PromoSweepService,
        private readonly jobs: JobService,
        private readonly promoPrices: PromoPriceService,
    ) {}
    offers() {
        return this.products.listAllOfferIds();
    }
    async current(offers: string[]): Promise<Map<string, unknown>> {
        const result = new Map<string, unknown>();
        const rows: ProductPriceDto[] = [];
        for (const part of chunk([...new Set(offers)], 1000)) {
            const response = await this.products.getPrices({
                offer_id: part,
                visibility: ProductVisibility.ALL,
                limit: part.length,
            });
            if (!Array.isArray(response?.items)) throw new Error('Ozon не вернул текущие цены');
            const found = new Set(response.items.map((item) => item.offer_id));
            if (found.size !== response.items.length || found.size !== part.length || part.some((id) => !found.has(id)))
                throw new Error('Неполный ответ текущих цен Ozon');
            rows.push(...response.items);
        }
        const states = new Map((await this.promoPrices.statesForPrices(rows)).map((s) => [s.offerId, s]));
        for (const item of rows) result.set(item.offer_id, { ...item.price, promoState: states.get(item.offer_id) });
        return result;
    }
    availability(offers: string[]) {
        return this.pricing.getPricingAvailability(offers);
    }
    matches(target: UpdatePriceDto, actual: unknown) {
        // /v5 возвращает и цену, установленную акцией. Повтор прихода не должен сбрасывать её к normal.
        return ozonPricesMatch(target, actual, 0) || ozonPromoPricesMatch(target, actual);
    }
    async persist(_targets: UpdatePriceDto[]) {}
    async verifyPromos(targets: UpdatePriceDto[]): Promise<Map<string, LossPriceResult>> {
        const current = await this.current(targets.map((t) => t.offer_id));
        return new Map(
            targets.map((t): [string, LossPriceResult] => [
                t.offer_id,
                ozonPromoPricesMatch(t, current.get(t.offer_id))
                    ? null
                    : {
                          message: 'Ozon ещё не подтвердил итоговую цену с акциями; задание оставлено для повтора',
                          kind: 'temporary',
                      },
            ]),
        );
    }
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
    async promos(
        offers: string[],
        snapshots?: Map<string, PricingSnapshot>,
        assertInputsCurrent?: (offerId: string) => Promise<void>,
    ) {
        const job = assertInputsCurrent
            ? this.sweep.start(true, 'min', 'incoming', offers, snapshots, assertInputsCurrent)
            : snapshots
              ? this.sweep.start(true, 'min', 'loss-queue', offers, snapshots)
              : this.sweep.start(true, 'min', 'loss-queue', offers);
        const activity = setJobActivity('ozon', 'Проверка акций Ozon', 'waiting');
        if (activity) activity.waitingFor = { id: job.id, kind: job.kind };
        const state = await this.jobs.whenDone(job.id);
        setJobActivity(
            'ozon',
            state.status === 'done' ? 'Проверка акций завершена' : 'Проверка акций не завершена',
            state.status === 'done' ? 'done' : 'failed',
            state.error,
        );
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
