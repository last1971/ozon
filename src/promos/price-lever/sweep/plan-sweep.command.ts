import { jobCheckpoint } from '../../../job/job.checkpoint';
import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { IPromoSweepContext } from './promo-sweep.context';
import { sweepGoal } from './sweep-goal';

/** План на каждый отобранный товар — тем правилом, что задаёт цель сверки. */
@Injectable()
export class PlanSweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Подготовка планов акций';
    readonly weight = 1;

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const goal = sweepGoal(context.goal);
        context.plans = [];
        const states = context.states ?? [];
        context.progress.total = states.length;
        for (const [index, s] of states.entries()) {
            if (index % 50 === 0) await jobCheckpoint(context);
            context.progress.done++;
            const error = context.pricingErrors?.get(s.offerId);
            if (!error) {
                context.plans.push(goal.plan(s));
                continue;
            }
            context.plans.push({
                offerId: s.offerId,
                productId: s.productId,
                state: s,
                target: s.minPrice,
                percent: s.seller?.isActive ? s.seller.percent : 0,
                floor: s.minPrice,
                steps: [],
                buyerBefore: s.buyerPrice,
                baseAfter: s.price,
                buyerAfter: s.buyerPrice,
                ok: false,
                closest: false,
                notes: [`Расчёт недоступен: ${error}`],
            });
        }
        return context;
    }
}
