import { priceUpdateQueue } from '../../../helpers/price/price-update.queue';
import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoPriceService } from '../promo-price.service';
import { IPromoSweepContext } from './promo-sweep.context';
import { sweepGoal } from './sweep-goal';

/** Весь каталог; предварительный отбор уточняется после расчёта минимальной цены. */
@Injectable()
export class CollectSweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Сбор товаров и акций Ozon';
    readonly weight = 3;

    constructor(private readonly promoPrice: PromoPriceService) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const snapshot = priceUpdateQueue.reader('ozon');
        const goal = sweepGoal(context.goal);
        const all = context.offerIds
            ? await this.promoPrice.allStates(context.offerIds)
            : await this.promoPrice.allStates();
        context.pricingSnapshots ??= new Map(
            all.map((s) => [s.offerId, snapshot([s.offerId, `#product:${s.productId}`])]),
        );
        context.collectedStates = all;
        context.checked = all.length;
        context.states = all.filter((s) => goal.selects(s));
        Object.assign(context.progress.counters, { checked: all.length, selected: context.states.length });
        context.logger?.log(
            `сверка акций (${goal.title}): в кабинете ${all.length}, отобрано ${context.states.length}`,
        );
        return context;
    }
}
