import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';

/** Только при apply: маркетплейс пишет «на правку», итог по карточке (taskId / error) — в отчёт. */
@Injectable()
export class UpdateTnvedCommand implements ICommandAsync<ITnvedProcessingContext> {
    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const toFix = context.report?.toFix ?? [];
        if (!context.opts.apply || !toFix.length) return context;

        const results = await context.service.updateTnved(toFix);
        for (const fix of toFix) {
            const r = results.find((x) => x.offer === fix.offer);
            if (!r) continue;
            if (r.taskId !== undefined) fix.taskId = r.taskId;
            if (r.error) fix.error = r.error;
        }
        return context;
    }
}
