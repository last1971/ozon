import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ICardSyncContext, progressKeyOf } from '../../interfaces/i.card.sync';
import { ProcessedCacheService } from '../../processed-cache/processed-cache.service';

/**
 * Прогресс раскатки: ctx.processed из ProcessedCacheService (набор режима ctx.progressCache); при onlyNew
 * обработанные выкидываются, limit режет уже отфильтрованное («следующие N необработанных») → ctx.base, ctx.skippedProcessed.
 */
@Injectable()
export class SkipProcessedCommand implements IJobCommand<ICardSyncContext<any, any>> {
    constructor(private readonly progress: ProcessedCacheService) {}

    async execute(context: ICardSyncContext<any, any>): Promise<ICardSyncContext<any, any>> {
        const { opts } = context;
        const all = context.all ?? [];
        context.processed = await this.progress.load(context.progressCache, opts.market);
        const fresh = opts.onlyNew ? all.filter((b) => !context.processed.has(progressKeyOf(b))) : all;
        context.skippedProcessed = all.length - fresh.length;
        context.base = opts.limit && opts.limit > 0 ? fresh.slice(0, opts.limit) : fresh;
        return context;
    }
}
