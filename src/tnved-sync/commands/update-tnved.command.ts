import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';

/** Только при apply: маркетплейс пишет «на правку», итог по карточке (taskId / error) — в отчёт. Фазу «запись» ставит сам маркетплейс, чтобы при dry-run она не появлялась. */
@Injectable()
export class UpdateTnvedCommand implements IJobCommand<ITnvedProcessingContext> {
    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const toFix = context.report?.toFix ?? [];
        if (!context.opts.apply || !toFix.length) return context;

        const results = await context.service.updateTnved(toFix, context.progress);
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
