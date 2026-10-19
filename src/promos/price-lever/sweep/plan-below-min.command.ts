import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { planPromoPrice } from '../promo-price.planner';
import { IPromoSweepContext } from './promo-sweep.context';

/**
 * План на каждый товар ниже минимума (решение 19.10): наш процент — минимум акции; Ozon-акции, чей лимит
 * держит пол, остаются с ценой не ниже пола; остальные — выкинуть. Без Ozon-акций цена = price × (1 − минимум %),
 * дальше цену подгоняют руками ручкой. Поэтому цель 'min' и процент ровно minPercent.
 */
@Injectable()
export class PlanBelowMinCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'план';

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        context.plans = (context.states ?? []).map((s) => planPromoPrice(s, 'min', s.seller?.minPercent));
        return context;
    }
}
