import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { IPromoSweepContext } from './promo-sweep.context';
import { sweepGoal } from './sweep-goal';

/** План на каждый отобранный товар — тем правилом, что задаёт цель сверки. */
@Injectable()
export class PlanSweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'план';

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const goal = sweepGoal(context.goal);
        context.plans = (context.states ?? []).map((s) => goal.plan(s));
        return context;
    }
}
