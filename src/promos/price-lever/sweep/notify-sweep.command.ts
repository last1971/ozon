import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { IPromoSweepContext } from './promo-sweep.context';

/** Отчёт применённой сверки, когда что-то поменяли (NotifierService → тема «цены»). */
export const OZON_PROMO_SWEEP_EVENT = 'ozon.promo.sweep';

/**
 * Последний шаг: при применении, если хоть один шаг реально изменил цену, — событие с отчётом.
 * Без изменений молчим: крон идёт раз в час, повторы «уже стоит» не должны давать уведомление.
 * results без поля changed (старый путь) считаются изменёнными для обратной совместимости.
 */
@Injectable()
export class NotifySweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Уведомление о результате';
    readonly weight = 1;

    constructor(private readonly events: EventEmitter2) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        const anyChanged = (context.results ?? []).some(
            (r) => r.applied && (r.results === undefined || r.results.some((s) => s.changed ?? true)),
        );
        if (context.apply && anyChanged) {
            this.events.emit(OZON_PROMO_SWEEP_EVENT, context.report);
        }
        return context;
    }
}
