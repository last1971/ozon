import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { BulkPriceContext } from './bulk-price.context';
@Injectable()
export class ReportBulkPricesCommand implements IJobCommand<BulkPriceContext> {
    readonly phase = 'Итог обновления';
    readonly weight = 1;
    async execute(ctx: BulkPriceContext) {
        const count = (status: string) => ctx.rows.filter((row) => row.status === status).length;
        ctx.report = {
            total: ctx.offers.length,
            accepted: count('accepted'),
            unchanged: count('unchanged'),
            skipped: count('skipped'),
            failed: count('error'),
            rows: ctx.rows,
            warnings: [...ctx.warnings.values()],
        };
        ctx.logger?.log(
            `${ctx.source.market}: принято ${ctx.report.accepted}, без изменений ${ctx.report.unchanged}, ` +
                `пропущено ${ctx.report.skipped}, ошибок ${ctx.report.failed}`,
        );
        for (const warning of ctx.report.warnings)
            ctx.logger?.log(`${warning.message}: ${warning.count}; примеры: ${warning.examples.join(', ')}`);
        if (ctx.report.failed) ctx.logger?.error(JSON.stringify({ failed: ctx.report.failed, examples: ctx.rows.filter((r) => r.status === 'error').slice(0, 20) }));
        ctx.progress.done = ctx.progress.total = 1;
        return ctx;
    }
}
