import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ITnvedProcessingContext, TNVED_PROGRESS_CACHE } from '../../interfaces/i.tnved.processing.context';
import { ProcessedCacheService } from '../../processed-cache/processed-cache.service';

/**
 * Прогресс раскатки после записи: товар закрыт, если есть карточки, ни одна не спорная и каждая
 * либо «уже ок», либо записана без ошибки. Остальные всплывут в следующем onlyNew-прогоне.
 * Пишет в ProcessedCacheService только при apply; report.remaining считает всегда.
 */
@Injectable()
export class MarkProcessedCommand implements ICommandAsync<ITnvedProcessingContext> {
    constructor(private readonly progress: ProcessedCacheService) {}

    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const processed = context.processed ?? new Set<string>();
        if (context.opts.apply) {
            for (const gc of this.completedGoods(context)) processed.add(gc);
            await this.progress.save(TNVED_PROGRESS_CACHE, context.opts.market, processed);
        }
        if (context.report) {
            context.report.remaining = (context.all ?? []).filter((b) => !processed.has(b.goodscode)).length;
        }
        return context;
    }

    private completedGoods(context: ITnvedProcessingContext): string[] {
        const failed = new Set<string>();
        for (const it of context.items ?? []) if (it.ambiguousReason) failed.add(it.goodscode);
        for (const f of context.report?.toFix ?? []) if (f.error) failed.add(f.goodscode);
        for (const gc of context.notFound ?? []) failed.add(gc);
        return (context.base ?? []).map((b) => b.goodscode).filter((gc) => !failed.has(gc));
    }
}
