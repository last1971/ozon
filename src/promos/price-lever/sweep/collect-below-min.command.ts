import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { PromoPriceService } from '../promo-price.service';
import { IPromoSweepContext } from './promo-sweep.context';

/** Все товары в акциях → только те, у кого цена покупателю ниже min_price (min_price — истинное дно). */
@Injectable()
export class CollectBelowMinCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'сбор';

    constructor(private readonly promoPrice: PromoPriceService) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const all = await this.promoPrice.allInActionsStates();
        context.checked = all.length;
        context.states = all.filter((s) => s.minPrice > 0 && s.buyerPrice > 0 && s.buyerPrice < s.minPrice);
        Object.assign(context.progress.counters, { checked: all.length, belowMin: context.states.length });
        context.logger?.log(`сверка акций: в акциях ${all.length}, ниже минимума ${context.states.length}`);
        return context;
    }
}
