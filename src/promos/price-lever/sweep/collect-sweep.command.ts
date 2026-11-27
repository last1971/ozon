import { Injectable } from '@nestjs/common';
import { priceUpdateQueue } from '../../../helpers/price/price-update.queue';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { guardPlan } from '../promo-price.planner';
import { PromoPriceService } from '../promo-price.service';
import { IPromoSweepContext } from './promo-sweep.context';
import { sweepGoal } from './sweep-goal';

/** Каталог (или артикулы задачи) одним чтением, план сторожа (только вверх), отбор целью. Минимальная — из Ozon. */
@Injectable()
export class CollectSweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Сбор цен Ozon и нашей акции';
    readonly weight = 3;

    constructor(private readonly promoPrice: PromoPriceService) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const snapshot = priceUpdateQueue.reader('ozon');
        const goal = sweepGoal(context.goal);
        const states = await this.promoPrice.pricedStates(context.offerIds);
        context.pricingSnapshots ??= new Map(
            states.map((s) => [s.offerId, snapshot([s.offerId, `#product:${s.productId}`])]),
        );
        context.checked = states.length;
        context.plans = states.map(guardPlan).filter((p) => goal.selects(p));
        Object.assign(context.progress.counters, { checked: states.length, selected: context.plans.length });
        context.logger?.log(
            `сверка цен Ozon (${goal.title}): в кабинете ${states.length}, отобрано ${context.plans.length}`,
        );
        return context;
    }
}
