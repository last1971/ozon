import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { groupLossPriceOffers } from './loss-price.offers';
import { LossPriceContext } from './loss-price.contracts';

/** Наличие проверяется до наценок, себестоимости и тарифов, в общей цепочке обеих площадок. */
@Injectable()
export class CheckLossPriceStockCommand implements IJobCommand<LossPriceContext> {
    readonly phase = 'Проверка наличия товара';
    readonly weight = 1;
    async execute(ctx: LossPriceContext) {
        const tasks = ctx.tasks.filter((task) => task.waitingForStock || (!task.error && !task.deferred));
        if (!tasks.length) return ctx;
        ctx.catalog ??= ctx.offerIds ?? (await ctx.adapter.offers());
        const byKey = groupLossPriceOffers(ctx.catalog);
        const offers = tasks.flatMap((task) => byKey.get(task.offerId) ?? []);
        let stocks: Awaited<ReturnType<typeof ctx.adapter.availability>>;
        try {
            stocks = await ctx.adapter.availability([...new Set(offers)]);
        } catch {
            stocks = new Map();
        }
        ctx.availableOffers = [...stocks].filter(([, stock]) => stock.state === 'available').map(([offer]) => offer);
        ctx.progress.total = tasks.length;
        ctx.progress.done = 0;
        for (const task of tasks) {
            await jobCheckpoint(ctx);
            const aliases = byKey.get(task.offerId) ?? [];
            const rows = aliases.map((offer) => stocks.get(offer));
            task.waitingForStock = false;
            task.deferred = false;
            task.error = undefined;
            if (!aliases.length) {
                task.error = 'Товар этой фасовки не найден в кабинете';
                task.failureKind = 'data';
            } else if (rows.some((row) => !row || row.state === 'unknown')) {
                task.error =
                    rows.find((row) => row?.state === 'unknown')?.message ?? 'Не удалось проверить наличие товара';
                task.failureKind = 'temporary';
            } else if (!rows.some((row) => row?.state === 'available')) task.waitingForStock = true;
            ctx.progress.done++;
        }
        ctx.progress.counters.waitingStock = ctx.tasks.filter((task) => task.waitingForStock).length;
        return ctx;
    }
}
