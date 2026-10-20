import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoPriceService } from '../promo-price.service';
import { IPromoSweepContext } from './promo-sweep.context';
import { sweepGoal } from './sweep-goal';

/** Все товары в акциях → только те, кого берёт цель сверки. */
@Injectable()
export class CollectSweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'сбор';

    constructor(private readonly promoPrice: PromoPriceService) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const goal = sweepGoal(context.goal);
        const all = await this.promoPrice.allInActionsStates();
        context.checked = all.length;
        context.states = all.filter((s) => goal.selects(s));
        Object.assign(context.progress.counters, { checked: all.length, selected: context.states.length });
        context.logger?.log(`сверка акций (${goal.title}): в акциях ${all.length}, отобрано ${context.states.length}`);
        return context;
    }
}
