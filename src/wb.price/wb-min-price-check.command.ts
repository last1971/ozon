import { Injectable } from '@nestjs/common';
import { IJobCommand, IJobContext } from '../interfaces/i.job.context';
import { WbPriceService, WbBulkPriceReport } from './wb.price.service';
export interface WbMinPriceContext extends IJobContext {
    report?: WbBulkPriceReport;
}
@Injectable()
export class WbMinPriceCheckCommand implements IJobCommand<WbMinPriceContext> {
    readonly phase = 'Проверка минимальных цен ВБ';
    readonly weight = 1;
    constructor(private readonly prices: WbPriceService) {}
    async execute(ctx: WbMinPriceContext) {
        ctx.report = await this.prices.setMinPrices([]);
        Object.assign(ctx.progress.counters, {
            checked: ctx.report.total ?? 0,
            changed: ctx.report.toUpdate,
            errors: ctx.report.errors.length,
            skipped: ctx.report.skipped?.length ?? 0,
        });
        ctx.progress.done = ctx.progress.total = ctx.report.total ?? 0;
        return ctx;
    }
}
