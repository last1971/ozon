import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ITnvedProcessingContext, TNVED_PROGRESS_CACHE } from '../../interfaces/i.tnved.processing.context';
import { ProcessedCacheService } from '../../processed-cache/processed-cache.service';

/**
 * Прогресс раскатки: ctx.processed из ProcessedCacheService; при onlyNew обработанные выкидываются,
 * limit режет уже отфильтрованное («следующие N необработанных») → ctx.base, ctx.skippedProcessed.
 */
@Injectable()
export class SkipProcessedCommand implements ICommandAsync<ITnvedProcessingContext> {
    constructor(private readonly progress: ProcessedCacheService) {}

    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const { opts } = context;
        const all = context.all ?? [];
        context.processed = await this.progress.load(TNVED_PROGRESS_CACHE, opts.market);
        const fresh = opts.onlyNew ? all.filter((b) => !context.processed.has(b.goodscode)) : all;
        context.skippedProcessed = all.length - fresh.length;
        context.base = opts.limit && opts.limit > 0 ? fresh.slice(0, opts.limit) : fresh;
        return context;
    }
}
