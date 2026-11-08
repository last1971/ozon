import { CheckLossPriceStockCommand } from './check-loss-price-stock.command';
import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { emptyProgress, IJobCommand } from '../../interfaces/i.job.context';
import { JobService } from '../../job/job.service';
import { assertPricingWritesAllowed } from '../../helpers/price/pricing-review-mode';
import { lossOfferKey } from '../../helpers/price/marketplace.loss.stats';
import { LOSS_PRICE_ADAPTERS, LossPriceAdapter, LossPriceContext, LossPriceMarket } from './loss-price.contracts';
import {
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
} from './loss-price.commands';

export interface MarketPriceOutcome {
    offerId: string;
    error?: string;
}
/** Общие команды расчёта, сравнения, записи, подтверждения и акций; без отдельной очереди. */
@Injectable()
export class MarketPriceWorkflowService {
    private readonly commands: IJobCommand<LossPriceContext>[];
    constructor(
        private readonly jobs: JobService,
        @Inject(LOSS_PRICE_ADAPTERS) private readonly adapters: Record<LossPriceMarket, LossPriceAdapter>,
        calculate: CalculateLossPriceTargetsCommand,
        compare: CompareLossPricesCommand,
        send: SendLossPricesCommand,
        confirm: ConfirmLossPricesCommand,
        promos: CheckLossPricePromosCommand,
        stock: CheckLossPriceStockCommand,
    ) {
        this.commands = [stock, calculate, compare, send, confirm, promos];
    }
    async incoming(
        service: LossPriceMarket,
        offers: string[],
        assertInputsCurrent?: (offer: string) => Promise<void>,
    ): Promise<MarketPriceOutcome[]> {
        const ids = [...new Set(offers)].sort();
        if (!ids.length) return [];
        assertPricingWritesAllowed();
        const job = this.jobs.run<LossPriceContext, MarketPriceOutcome[]>({
            kind: `incoming-prices:${service.toLowerCase()}`,
            // Не присоединяться к другой версии документа или ручному запуску.
            params: { offers: ids, runId: randomUUID() },
            clientId: 'incoming',
            measure: true,
            commands: this.commands,
            cleanup: async () => {},
            context: {
                service,
                offerIds: ids,
                adapter: this.adapters[service],
                sent: 0,
                assertInputsCurrent,
                progress: emptyProgress(),
                tasks: [...new Set(ids.map(lossOfferKey))].map((offerId) => ({
                    offerId,
                    events: [],
                    targets: [],
                    changed: [],
                })),
            },
            result: (ctx) => {
                ctx.progress.counters.pending = ctx.tasks.filter((t) => t.error || t.waitingForStock).length;
                ctx.progress.counters.completed = ctx.tasks.filter((t) => !t.error && !t.waitingForStock).length;
                return ctx.tasks.map((t) => ({ offerId: t.offerId, ...(t.waitingForStock ? { error: 'Ожидание остатка' } : t.error ? { error: t.error } : {}) }));
            },
        });
        const done = await this.jobs.whenDone(job.id);
        if (done.status !== 'done') throw new Error(done.error || 'Обновление цен по приходу не завершено');
        return done.result as MarketPriceOutcome[];
    }
}
