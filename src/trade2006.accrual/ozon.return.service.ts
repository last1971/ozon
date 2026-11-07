import { OzonLossFinancialCommands, OzonLossExpenseContext } from './ozon.loss.expense.commands';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { lossPeriod } from '../helpers/price/marketplace.loss.stats';
import { ProductService } from '../product/product.service';
import { OzonReturnPreviewService } from './ozon.return.preview.service';
import { OzonReturnStore } from './ozon.return.store';
import { JobService } from '../job/job.service';
import { emptyProgress } from '../interfaces/i.job.context';
import { MpReturnAcceptStore } from '../mp-event/mp-return-accept.store';
import {
    LoadLossHistoryCommand,
    LoadLossWriteOffsCommand,
    CalculateLossReportCommand,
    SaveLossSnapshotCommand,
    ApplyLossExpensesCommand,
} from '../marketplace-loss/loss.commands';
import { LoadOzonLossCatalogCommand, ApplyOzonReturnPolicyCommand, OzonLossContext } from './ozon.loss.commands';
import { OzonLossHistorySource } from './ozon.loss-history.source';

/** Организация суточного пересчёта: существующий каталог → готовый расчёт → атомарное сохранение. */
@Injectable()
export class OzonReturnService {
    private readonly logger = new Logger(OzonReturnService.name);
    private running = false;

    constructor(
        private readonly config: ConfigService,
        private readonly products: ProductService,
        private readonly previewService: OzonReturnPreviewService,
        private readonly store: OzonReturnStore,
        private readonly writeOffs: MpReturnAcceptStore,
        private readonly jobs: JobService,
        private readonly financials: OzonLossFinancialCommands,
    ) {}

    @Cron('0 38 5 * * *', { name: 'ozonReturnPerc', timeZone: 'Europe/Moscow' })
    async daily(): Promise<void> {
        const services = this.config.get<string[] | string>('SERVICES', []);
        if (
            this.config.get('NODE_ENV') !== 'production' ||
            !(Array.isArray(services) ? services : services.split(',')).includes('ozon')
        )
            return;
        try {
            const result = await this.recalculate();
            this.logger.log(
                `Возвраты Ozon: сохранено ${result.rows} фасовок за ${result.from} — ${result.to} (не включая)`,
            );
        } catch (error) {
            this.logger.error(`Не удалось обновить процент возвратов Ozon: ${error.message}`);
        }
    }

    async recalculate(now = new Date()): Promise<{ rows: number; from: string; to: string }> {
        if (this.running) throw new Error('Пересчёт возвратов Ozon уже выполняется');
        this.running = true;
        try {
            const { from, to } = lossPeriod(now);
            const context: OzonLossExpenseContext = {
                service: 'OZON',
                preliminary: false,
                period: { from, to },
                calculatedAt: now,
                minSales: Number(this.config.get('OZON_RETURN_MIN_SALES', 1)),
                defaultPerc: Number(this.config.get('OZON_RETURN_PERC_DEFAULT', 0)),
                catalog: [],
                skuToOffer: new Map(),
                knownOffers: [],
                sales: [],
                rows: [],
                writeOffs: [],
                progress: emptyProgress(),
            };
            const job = this.jobs.run<OzonLossExpenseContext, { rows: number; from: string; to: string }>({
                kind: 'loss-recalculate:ozon',
                params: { from, to },
                context,
                commands: [
                    new LoadOzonLossCatalogCommand(this.products, this.store),
                    new LoadLossHistoryCommand(new OzonLossHistorySource(this.previewService, context)),
                    new LoadLossWriteOffsCommand(this.writeOffs),
                    ...this.financials.loading,
                    new CalculateLossReportCommand(),
                    new ApplyOzonReturnPolicyCommand(),
                    this.financials.calculate,
                    new ApplyLossExpensesCommand(),
                    new SaveLossSnapshotCommand(this.store),
                ],
                canCancel: (c) => !c.committing,
                // Транзакцией владеет store; JobService ждёт выхода команды и её rollback.
                cleanup: async () => {},
                result: (c) => ({ rows: c.rows.length, ...c.period }),
            });
            const done = await this.jobs.whenDone(job.id);
            if (done.status !== 'done') throw new Error(done.error);
            return done.result as { rows: number; from: string; to: string };
        } finally {
            this.running = false;
        }
    }
}
