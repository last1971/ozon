import { Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { BulkPriceContext, BulkPriceRow } from './bulk-price.context';
import { ozonResultsByOffer, PriceUpdateReport } from '../price-update.report';

function rowsFor(offers: string[], report: PriceUpdateReport, market: string): BulkPriceRow[] {
    const skipped = new Map(report.skipped.map((r) => [r.offer_id, r]));
    const ozon = ozonResultsByOffer(report.response);
    const wb = new Map<string, any>((report.response?.results ?? []).map((r) => [r.offer_id, r]));
    return offers.map((offer_id): BulkPriceRow => {
        const skip = skipped.get(offer_id);
        if (skip) return { offer_id, status: 'skipped', reason: skip.message ?? skip.reason,
            ...(market === 'ozon' && skip.failureKind === 'temporary' && { retryable: true }) };
        if (market === 'ozon') {
            const row = ozon.get(offer_id);
            return row?.updated
                ? { offer_id, status: 'accepted', ...(row.observedBuyerPrice !== undefined && { observedBuyerPrice: row.observedBuyerPrice }) }
                : {
                      offer_id,
                      status: 'error',
                      ...(row?.transition === 'pending' && { retryable: true }),
                      reason:
                          row?.errors?.map((e) => [e.code, e.message].filter(Boolean).join(': ')).join('; ') ||
                          'Нет подтверждения Ozon',
                  };
        }
        const row = wb.get(offer_id);
        return row
            ? { offer_id, status: row.status, ...(row.message ? { reason: row.message } : {}) }
            : { offer_id, status: 'error', reason: 'Нет подтверждения WB' };
    });
}
@Injectable()
export class UpdateBulkPricesCommand implements IJobCommand<BulkPriceContext> {
    readonly phase = 'Расчёт цен и подготовка запросов';
    readonly weight = 18;
    async execute(ctx: BulkPriceContext) {
        ctx.progress.total = ctx.offers.length;
        const catalog = new Set(ctx.offers);
        const saved = await ctx.source.checkpoint?.load() ?? [];
        const byOffer = new Map(saved.filter(row => catalog.has(row.offer_id)).map(row => [row.offer_id, row]));
        const updateProgress = () => {
            ctx.progress.done = byOffer.size;
            for (const status of ['accepted', 'unchanged', 'skipped', 'error'])
                ctx.progress.counters[status] = 0;
            for (const row of byOffer.values()) ctx.progress.counters[row.status]++;
        };
        updateProgress();
        const process = async (offers: string[]) => {
            for (const batch of chunk(offers, 100)) {
                await jobCheckpoint(ctx);
                let rows: BulkPriceRow[];
                try {
                    rows = rowsFor(batch, await ctx.source.update(batch, ctx), ctx.source.market);
                } catch (error) {
                    if (ctx.stopChain) throw error;
                    rows = batch.map(offer_id => ({ offer_id, status: 'error', reason: error.message, retryable: true }));
                }
                if (ctx.stopChain) throw new Error('Задача остановлена');
                for (const row of rows) byOffer.set(row.offer_id, row);
                await ctx.source.checkpoint?.save([...byOffer.values()], false);
                ctx.progress.counters.batches = (ctx.progress.counters.batches ?? 0) + 1;
                updateProgress();
            }
        };
        await process(ctx.offers.filter(offer => !byOffer.has(offer)));
        if (ctx.source.checkpoint) {
            // Re-read costs and marketplace state. The durable transition journal only
            // permits a write after the previous step has been reconciled.
            const retry = [...byOffer.values()].filter(row => row.retryable).map(row => row.offer_id);
            ctx.progress.counters.rechecking = retry.length;
            await process(retry);
        }
        ctx.rows = ctx.offers.map(offer => byOffer.get(offer));
        await ctx.source.checkpoint?.save(ctx.rows, true);
        return ctx;
    }
}
