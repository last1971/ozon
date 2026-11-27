import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { OzonPriceWriter } from '../ozon-price-writer';
import { PromoPriceService } from '../promo-price.service';
import { PromoPricePlan } from '../promo-price.types';
import { IPromoSweepContext } from './promo-sweep.context';
import { verifySweepChanges } from './verify-sweep-changes';

/** Применить планы одной пачкой; изменившийся после чтения товар пропускается до следующей сверки. */
@Injectable()
export class ApplySweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Отправка цен Ozon';
    readonly weight = 20;

    constructor(
        private readonly writer: OzonPriceWriter,
        private readonly prices: PromoPriceService,
    ) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        if (!context.apply || context.stopChain) return context;
        const plans = (context.plans ?? []).filter((p) => p.steps.length);
        context.progress.total = plans.length;
        context.progress.done = 0;
        if (!plans.length) return context;
        context.results = await this.writer.applyPlans(plans, (plan: PromoPricePlan) => ({
            shouldStop: () => Boolean(context.stopChain),
            snapshot: context.pricingSnapshots?.get(plan.offerId),
            priority: 'background' as const,
            onWaiting: (waiting: boolean) => {
                context.progress.counters.waiting = Number(waiting);
            },
            assertCurrent: async () => {
                await context.assertInputsCurrent?.(plan.offerId);
                if (context.stopChain) throw new Error('Задача остановлена');
            },
        }));
        for (const res of context.results) {
            context.progress.done++;
            const key = res.applied ? 'appliedOk' : 'appliedFailed';
            context.progress.counters[key] = (context.progress.counters[key] ?? 0) + 1;
        }
        await verifySweepChanges(context.results, this.prices);
        return context;
    }
}
