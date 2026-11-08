import { Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { BulkPriceContext, BulkPriceRow } from './bulk-price.context';
import { ozonResultsByOffer, PriceUpdateReport } from '../price-update.report';

function rowsFor(offers: string[], report: PriceUpdateReport, market: string): BulkPriceRow[] {
    const skipped = new Map(report.skipped.map((r) => [r.offer_id, r.message ?? r.reason]));
    const ozon = ozonResultsByOffer(report.response);
    const wb = new Map<string, any>((report.response?.results ?? []).map((r) => [r.offer_id, r]));
    return offers.map((offer_id): BulkPriceRow => {
        if (skipped.has(offer_id)) return { offer_id, status: 'skipped', reason: skipped.get(offer_id) };
        if (market === 'ozon') {
            const row = ozon.get(offer_id);
            return row?.updated
                ? { offer_id, status: 'accepted' }
                : {
                      offer_id,
                      status: 'error',
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
    readonly phase = 'Расчёт и отправка цен';
    readonly weight = 18;
    async execute(ctx: BulkPriceContext) {
        ctx.progress.total = ctx.offers.length;
        for (const batch of chunk(ctx.offers, 100)) {
            await jobCheckpoint(ctx);
            let rows: BulkPriceRow[];
            try {
                rows = rowsFor(batch, await ctx.source.update(batch, ctx), ctx.source.market);
            } catch (error) {
                rows = batch.map((offer_id) => ({ offer_id, status: 'error', reason: error.message }));
            }
            ctx.rows.push(...rows);
            for (const row of rows) ctx.progress.counters[row.status] = (ctx.progress.counters[row.status] ?? 0) + 1;
            ctx.progress.done += batch.length;
        }
        return ctx;
    }
}
