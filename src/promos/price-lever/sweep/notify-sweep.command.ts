import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { IPromoSweepContext } from './promo-sweep.context';

export const OZON_PROMO_SWEEP_EVENT = 'ozon.promo.sweep';

/** Сообщение в Matrix только когда Ozon подтвердил хоть одно изменение этого прохода. */
@Injectable()
export class NotifySweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Уведомление о результате';
    readonly weight = 1;

    constructor(private readonly events: EventEmitter2) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        if (context.apply && context.report?.items.some((item) => item.verification === 'confirmed'))
            await this.events.emitAsync(OZON_PROMO_SWEEP_EVENT, context.report);
        return context;
    }
}
