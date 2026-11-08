import { Injectable, Logger } from '@nestjs/common';
import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { withPricingWarnings } from '../../helpers/price/pricing-warnings';
import { BulkPriceContext, BulkPriceSource, BulkPriceReport } from './bulk-price.context';
import { CollectBulkPricesCommand } from './collect-bulk-prices.command';
import { UpdateBulkPricesCommand } from './update-bulk-prices.command';
import { ReportBulkPricesCommand } from './report-bulk-prices.command';
@Injectable()
export class BulkPriceJobService {
    private readonly logger = new Logger(BulkPriceJobService.name);
    constructor(
        private readonly jobs: JobService,
        private readonly collect: CollectBulkPricesCommand,
        private readonly update: UpdateBulkPricesCommand,
        private readonly report: ReportBulkPricesCommand,
    ) {}
    start(source: BulkPriceSource, clientId?: string) {
        const context: BulkPriceContext = {
            source,
            offers: [],
            rows: [],
            warnings: new Map(),
            progress: { ...emptyProgress(), phase: 'Ожидание очереди' },
            logger: this.logger,
        };
        return this.jobs.run({
            kind: `price-bulk:${source.market}`,
            params: {},
            clientId,
            context,
            commands: [this.collect, this.update, this.report],
            execute: (run) => withPricingWarnings(context.warnings, run),
            // После отмены ждём текущий запрос; следующий пакет уже не отправляем.
            cleanup: async () => {},
            result: (ctx) => ctx.report,
        });
    }
    async wait(id: string): Promise<BulkPriceReport> {
        const state = await this.jobs.whenDone(id);
        if (state.status !== 'done') throw new Error(state.error || 'Обновление остановлено');
        return state.result as BulkPriceReport;
    }
}
