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
        context.plans = (context.states ?? []).map((s) => {
            const error = context.pricingErrors?.get(s.offerId);
            if (!error) return goal.plan(s);
            return {
                offerId: s.offerId,
                productId: s.productId,
                state: s,
                target: s.minPrice,
                percent: s.seller?.isActive ? s.seller.percent : 0,
                floor: s.minPrice,
                steps: [],
                buyerBefore: s.buyerPrice,
                buyerAfter: s.buyerPrice,
                ok: false,
                closest: false,
                notes: [`Расчёт недоступен: ${error}`],
            };
        });
        return context;
    }
}
