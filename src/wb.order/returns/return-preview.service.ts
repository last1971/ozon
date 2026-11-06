import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobService } from '../../job/job.service';
import { LoadWbLossSalesCommand } from './load-sales.command';
import { LoadWbWriteOffsCommand } from './load-write-offs.command';
import { CalculateWbLossReportCommand } from './calculate-loss-report.command';
import { createWbLossContext } from './return-preview.context';

@Injectable()
export class WbReturnPreviewService {
    constructor(
        private readonly jobs: JobService,
        private readonly config: ConfigService,
        private readonly sales: LoadWbLossSalesCommand,
        private readonly writeOffs: LoadWbWriteOffsCommand,
        private readonly calculate: CalculateWbLossReportCommand,
    ) {}
    start(clientId?: string, now = new Date()) {
        const context = createWbLossContext(this.config, now);
        return this.jobs.run({
            kind: 'loss-preview:wb',
            params: { ...context.period },
            clientId,
            context,
            commands: [this.sales, this.writeOffs, this.calculate],
            result: (c) => ({
                service: 'WB',
                ...c.period,
                preliminary: true,
                rows: c.rows,
                note: 'Предварительная статистика supplier/sales. Проценты и цены не сохранялись; компенсации не вычитались.',
            }),
        });
    }
}
