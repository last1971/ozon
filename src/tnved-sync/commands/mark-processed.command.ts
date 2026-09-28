import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ICardSyncContext, progressKeyOf } from '../../interfaces/i.card.sync';
import { ProcessedCacheService } from '../../processed-cache/processed-cache.service';

/**
 * Прогресс раскатки после записи: товар закрыт, если есть карточки, ни одна не спорная и каждая
 * либо «уже ок», либо записана без ошибки. Остальные всплывут в следующем onlyNew-прогоне.
 * Пишет в ProcessedCacheService (набор режима ctx.progressCache) только при apply; report.remaining считает всегда.
 */
@Injectable()
export class MarkProcessedCommand implements IJobCommand<ICardSyncContext<any, any>> {
    constructor(private readonly progress: ProcessedCacheService) {}

    async execute(context: ICardSyncContext<any, any>): Promise<ICardSyncContext<any, any>> {
        const processed = context.processed ?? new Set<string>();
        if (context.opts.apply) {
            for (const key of this.completedKeys(context)) processed.add(key);
            await this.progress.save(context.progressCache, context.opts.market, processed);
        }
        if (context.report) {
            context.report.remaining = (context.all ?? []).filter((b) => !processed.has(progressKeyOf(b))).length;
        }
        return context;
    }

    private completedKeys(context: ICardSyncContext<any, any>): string[] {
        const failed = new Set<string>();
        for (const it of context.items ?? []) if (it.ambiguousReason) failed.add(it.goodscode);
        for (const f of context.report?.toFix ?? []) if (f.error) failed.add(f.goodscode);
        for (const gc of context.notFound ?? []) failed.add(gc);
        return (context.base ?? []).filter((b) => !failed.has(b.goodscode)).map(progressKeyOf);
    }
}
