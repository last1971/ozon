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
}
@Injectable()
export class PriceReviewService {
    private readonly logger = new Logger(PriceReviewService.name);
    private readonly reviews = new Map<string, Review>();
    constructor(
        private readonly jobs: JobService,
        private readonly prepare: PreparePriceReviewCommand,
        private readonly send: SendPriceReviewCommand,
    ) {}
    prepareReview(offerId: string, clientId?: string) {
        this.cleanup();
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
                this.reviews.set(token, { offerId, expiresAt, entries });
                return { token, offerId, expiresAt, entries: structuredClone(entries) };
            },
        });
    }
    sendReview(token: string, clientId?: string) {
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
                progress: emptyProgress(),
                logger: this.logger,
            },
            commands: [this.send],
            result: (ctx) => ({ offerId: ctx.offerId, entries: ctx.entries, sent: true }),
        });
        review.jobId = state.id;
        return state;
    }
    private cleanup() {
        for (const [token, review] of this.reviews)
            if (review.expiresAt < Date.now() && (!review.jobId || this.jobs.get(review.jobId)?.status !== 'running'))
                this.reviews.delete(token);
    }
}
