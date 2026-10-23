import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { IPromoSweepContext } from './promo-sweep.context';

/** Отчёт применённой сверки, когда что-то поменяли (NotifierService → тема «цены»). */
export const OZON_PROMO_SWEEP_EVENT = 'ozon.promo.sweep';

/**
 * Последний шаг: при применении, если хоть один товар поменяли, — событие с отчётом.
 * Без изменений молчим: крон идёт раз в 30 минут, непрошедшие повторялись бы каждый прогон.
 */
@Injectable()
export class NotifySweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'уведомление';

    constructor(private readonly events: EventEmitter2) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        if (context.apply && (context.results ?? []).some((r) => r.applied)) {
            this.events.emit(OZON_PROMO_SWEEP_EVENT, context.report);
        }
        return context;
    }
}
