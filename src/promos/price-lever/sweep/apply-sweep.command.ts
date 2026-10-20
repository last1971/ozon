import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoPriceApplier } from '../promo-price.applier';
import { IPromoSweepContext } from './promo-sweep.context';

/** Применить планы по одному товару. Без apply — пропуск. Отмена задачи проверяется между товарами. */
@Injectable()
export class ApplySweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'применение';

    constructor(private readonly applier: PromoPriceApplier) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        if (!context.apply) return context;
        const plans = (context.plans ?? []).filter((p) => p.steps.length);
        context.results = [];
        context.progress.total = plans.length;
        context.progress.done = 0;
        for (const plan of plans) {
            if (context.stopChain) break;
            const res = await this.applier.apply(plan);
            context.results.push(res);
            context.progress.done++;
            const key = res.applied ? 'appliedOk' : 'appliedFailed';
            context.progress.counters[key] = (context.progress.counters[key] ?? 0) + 1;
        }
        return context;
    }
}
