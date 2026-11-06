import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { BulkPriceContext } from './bulk-price.context';
@Injectable()
export class CollectBulkPricesCommand implements IJobCommand<BulkPriceContext> {
    readonly phase = 'Загрузка товаров';
    readonly weight = 1;
    async execute(ctx: BulkPriceContext) {
        let cursor = '';
        const seen = new Set<string>();
        const offers = new Set<string>();
        do {
            await jobCheckpoint(ctx);
            const page = await ctx.source.page(cursor);
            page.offers.forEach((offer) => offers.add(offer));
            ctx.progress.done = offers.size;
            if (!page.next) break;
            if (seen.has(page.next)) throw new Error('Не продвигается курсор каталога');
            seen.add(page.next);
            cursor = page.next;
        } while (true);
        ctx.offers = [...offers];
        ctx.progress.total = ctx.offers.length;
        return ctx;
    }
}
