import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IJobCommand } from '../../../interfaces/i.job.context';
import { OzonTransitionJournal, TransitionClaim, TransitionNotice } from '../ozon-transition-journal';
import { PromoPriceApplyResult } from '../promo-price.types';
import { BuildSweepReportCommand } from './build-sweep-report.command';
import { IPromoSweepContext } from './promo-sweep.context';

export const OZON_PROMO_SWEEP_EVENT = 'ozon.promo.sweep';

@Injectable()
export class NotifySweepCommand implements IJobCommand<IPromoSweepContext> {
    readonly phase = 'Уведомление о результате';
    readonly weight = 1;

    constructor(private readonly events: EventEmitter2, private readonly journal?: OzonTransitionJournal) {}

    async execute(context: IPromoSweepContext): Promise<IPromoSweepContext> {
        if (!context.apply) return context;
        if (!this.journal) {
            if (context.report?.items.some(item => item.verification === 'confirmed'))
                this.events.emit(OZON_PROMO_SWEEP_EVENT, context.report);
            return context;
        }

        // Решение о подтверждении и запись уведомления уже зафиксированы одной транзакцией.
        // Даже если цена теперь на месте и планировщик ничего не отобрал, прочитаем квитанцию.
        const pending = await this.journal.outstanding<TransitionNotice>('PROMO_NOTICE');
        const scope = context.offerIds && new Set(context.offerIds);
        const receipts = new Map<string, TransitionClaim<TransitionNotice>>();
        for (const [key, row] of pending) {
            if (scope && !scope.has(row.payload.result.offerId)) continue;
            if (row.payload.deliveringUntil > Date.now()) continue;
            const reserved = await this.journal.advance(key, row.token,
                { ...row.payload, deliveringUntil: Date.now() + 10 * 60_000 }, 'PROMO_NOTICE');
            if (reserved) receipts.set(key, reserved);
        }
        if (!receipts.size) return context;

        const results = [...receipts.values()].map(row => row.payload.result);
        const builder = new BuildSweepReportCommand();
        const message = await builder.execute({ ...context, plans: results, results, progress: { done: 0, counters: {} } });
        await this.includeRecovered(context, builder, results);
        let acknowledged = false;
        try {
            const deliveryKey = createHash('sha256').update(JSON.stringify([...receipts.keys()].sort())).digest('hex');
            const deliveries = await this.events.emitAsync(OZON_PROMO_SWEEP_EVENT, message.report, deliveryKey);
            acknowledged = deliveries.some(delivered => delivered === true);
        } finally {
            for (const [key, row] of receipts) {
                if (acknowledged) await this.journal.finish(key, row.token, 'PROMO_NOTICE');
                else await this.journal.advance(key, row.token, { result: row.payload.result }, 'PROMO_NOTICE');
            }
        }
        return context;
    }

    private async includeRecovered(context: IPromoSweepContext, builder: BuildSweepReportCommand, results: PromoPriceApplyResult[]) {
        const current = new Set((context.results ?? []).map(row => row.offerId));
        const recovered = results.filter(row => !current.has(row.offerId));
        if (!recovered.length) return;
        const ids = new Set(recovered.map(row => row.offerId));
        context.plans = [...(context.plans ?? []).filter(plan => !ids.has(plan.offerId)), ...recovered];
        context.results = [...(context.results ?? []), ...recovered];
        await builder.execute(context);
    }
}
