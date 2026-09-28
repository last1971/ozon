import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ICardSyncContext } from '../../interfaces/i.card.sync';

/** Только при apply: маркетплейс пишет «на правку», итог по карточке (taskId / error) — в отчёт. Фазу «запись» ставит сам маркетплейс, чтобы при dry-run она не появлялась. */
@Injectable()
export class UpdateCardsCommand implements IJobCommand<ICardSyncContext<any, any>> {
    async execute(context: ICardSyncContext<any, any>): Promise<ICardSyncContext<any, any>> {
        const toFix = context.report?.toFix ?? [];
        if (!context.opts.apply || !toFix.length) return context;

        const results = await context.service.update(toFix, context.progress);
        for (const fix of toFix) {
            const r = results.find((x) => x.offer === fix.offer);
            if (!r) continue;
            if (r.taskId !== undefined) fix.taskId = r.taskId;
            if (r.error) fix.error = r.error;
        }
        context.progress.counters.writeErrors = toFix.filter((f) => f.error).length;
        return context;
    }
}
