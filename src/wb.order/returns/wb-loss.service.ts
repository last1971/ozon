import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobService } from '../../job/job.service';
import { SaveLossContext, SaveLossSnapshotCommand } from '../../marketplace-loss/loss.commands';
import { LoadWbLossSalesCommand } from './load-sales.command';
import { LoadWbWriteOffsCommand } from './load-write-offs.command';
import { CalculateWbLossReportCommand } from './calculate-loss-report.command';
import { createWbLossContext } from './return-preview.context';

export interface WbLossResult {
    service: string;
    preliminary: boolean;
    from: string;
    to: string;
    calculatedAt: Date;
    rows: number;
}

/** Сохраняет статистику ВБ общими командами; расчёт цен к ней ещё не подключён. */
@Injectable()
export class WbLossService {
    constructor(
        private readonly jobs: JobService,
        private readonly config: ConfigService,
        private readonly sales: LoadWbLossSalesCommand,
        private readonly writeOffs: LoadWbWriteOffsCommand,
        private readonly calculate: CalculateWbLossReportCommand,
        private readonly save: SaveLossSnapshotCommand,
    ) {}

    start(clientId?: string, now = new Date()) {
        const context = createWbLossContext(this.config, now);
        return this.jobs.run<SaveLossContext, WbLossResult>({
            kind: 'loss-recalculate:wb',
            params: { ...context.period },
            clientId,
            context,
            commands: [this.sales, this.writeOffs, this.calculate, this.save],
            canCancel: (c) => !c.committing,
            // Транзакцией владеет хранилище; при отмене ждём завершения команды и отката.
            cleanup: async () => {},
            result: (c) => ({
                service: c.service,
                preliminary: c.preliminary,
                ...c.period,
                calculatedAt: c.calculatedAt,
                rows: c.rows.length,
            }),
        });
    }
}
