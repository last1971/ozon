import { priceUpdateQueue, PricingSnapshot } from '../helpers/price/price-update.queue';
import { GoodServiceEnum } from '../good/good.service.enum';
import { lossOfferKey } from '../helpers/price/marketplace.loss.stats';
import { OnEvent } from '@nestjs/event-emitter';
import { LOSS_SAVED_EVENT } from '../marketplace-loss/prices/loss-price.contracts';
import { assertPricingWritesAllowed } from '../helpers/price/pricing-review-mode';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JobService } from '../job/job.service';
import { emptyProgress } from '../interfaces/i.job.context';
import {
    PreparePriceReviewCommand,
    PriceReviewContext,
    PriceReviewEntry,
    SendPriceReviewCommand,
} from './price-review.commands';

const TTL = 5 * 60_000;
interface Review {
    offerId: string;
    expiresAt: number;
    entries: PriceReviewEntry[];
    jobId?: string;
    lossRevisions: Map<string, number>;
    pricingSnapshots: Map<string, PricingSnapshot>;
}
@Injectable()
export class PriceReviewService {
    private readonly logger = new Logger(PriceReviewService.name);
    private readonly lossRevisions = new Map<string, number>();
    private readonly reviews = new Map<string, Review>();
    constructor(
        private readonly jobs: JobService,
        private readonly prepare: PreparePriceReviewCommand,
        private readonly send: SendPriceReviewCommand,
    ) {}
    prepareReview(offerId: string, clientId?: string) {
        this.cleanup();
        const lossRevisions = new Map(this.lossRevisions);
        const pricingSnapshots = new Map(
            Object.values(GoodServiceEnum).map((key) => [key, priceUpdateQueue.capture(key, [offerId])]),
        );
        return this.jobs.run<PriceReviewContext, unknown>({
            kind: `price-review:${offerId}`,
            params: { offerId, mode: 'prepare' },
            clientId,
            context: { offerId, entries: [], progress: emptyProgress(), logger: this.logger },
            commands: [this.prepare],
            result: (ctx) => {
                const token = randomUUID(),
                    expiresAt = Date.now() + TTL;
                const entries = structuredClone(ctx.entries);
                this.reviews.set(token, { offerId, expiresAt, entries, lossRevisions, pricingSnapshots });
                return { token, offerId, expiresAt, entries: structuredClone(entries) };
            },
        });
    }
    sendReview(token: string, clientId?: string) {
        assertPricingWritesAllowed();
        this.cleanup();
        const review = this.reviews.get(token);
        if (!review) throw new BadRequestException('Предпросмотр устарел. Подготовьте цены заново.');
        if (review.jobId) return this.jobs.get(review.jobId);
        if (!review.entries.some((e) => !e.error && e.prices.length))
            throw new BadRequestException('Нет цен для отправки');
        const state = this.jobs.run<PriceReviewContext, unknown>({
            kind: `price-review:${review.offerId}`,
            params: { token, mode: 'send' },
            clientId,
            context: {
                offerId: review.offerId,
                entries: structuredClone(review.entries),
                assertCurrent: (service) => {
                    if (review.expiresAt < Date.now())
                        throw new BadRequestException('Предпросмотр устарел. Подготовьте цены заново.');
                    priceUpdateQueue.assertCurrent(review.pricingSnapshots.get(service));
                    const key = service.toUpperCase();
                    const keys = [key, `${key}:${this.lossOffer(review.offerId)}`];
                    if (keys.some((k) => (this.lossRevisions.get(k) ?? 0) !== (review.lossRevisions.get(k) ?? 0)))
                        throw new BadRequestException('Статистика потерь изменилась. Подготовьте цены заново.');
                },
                progress: emptyProgress(),
                logger: this.logger,
            },
            commands: [this.send],
            result: (ctx) => ({ offerId: ctx.offerId, entries: ctx.entries, sent: true }),
        });
        review.jobId = state.id;
        return state;
    }
    @OnEvent(LOSS_SAVED_EVENT)
    lossSaved(service: string, offers?: string[]) {
        const key = service.toUpperCase();
        const keys = offers ? offers.map((offer) => `${key}:${this.lossOffer(offer)}`) : [key];
        for (const k of keys) this.lossRevisions.set(k, (this.lossRevisions.get(k) ?? 0) + 1);
    }
    private lossOffer(offer: string): string {
        try {
            return lossOfferKey(offer);
        } catch {
            return offer;
        }
    }
    private cleanup() {
        for (const [token, review] of this.reviews)
            if (review.expiresAt < Date.now() && (!review.jobId || this.jobs.get(review.jobId)?.status !== 'running'))
                this.reviews.delete(token);
    }
}
