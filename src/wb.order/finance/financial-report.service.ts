import { Injectable } from '@nestjs/common';
import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { TransactionFilterDate } from '../../posting/dto/transaction.filter.dto';
import { WbTransactionDto } from '../dto/wb.transaction.dto';
import { WbFinancialContext } from './financial-report.context';
import {
    ValidateWbFinancialReportCommand,
    LoadWbFinancialReportCommand,
    NormalizeWbFinancialReportCommand,
} from './financial-report.commands';

@Injectable()
export class WbFinancialReportService {
    constructor(
        private readonly jobs: JobService,
        private readonly validate: ValidateWbFinancialReportCommand,
        private readonly load: LoadWbFinancialReportCommand,
        private readonly normalize: NormalizeWbFinancialReportCommand,
    ) {}
    start(data: TransactionFilterDate, cursor = 0, clientId?: string) {
        const context: WbFinancialContext = {
            from: data.from,
            to: data.to,
            cursor,
            raw: [],
            rows: [],
            progress: emptyProgress(),
        };
        return this.jobs.run<WbFinancialContext, WbTransactionDto[]>({
            kind: 'wb-financial-report',
            params: {
                from:
                    data.from instanceof Date && Number.isFinite(data.from.getTime())
                        ? data.from.toISOString()
                        : String(data.from),
                to:
                    data.to instanceof Date && Number.isFinite(data.to.getTime())
                        ? data.to.toISOString()
                        : String(data.to),
                cursor,
            },
            clientId,
            context,
            commands: [this.validate, this.load, this.normalize],
            result: (c) => c.rows,
        });
    }
    async read(data: TransactionFilterDate, cursor = 0): Promise<WbTransactionDto[]> {
        const job = this.start(data, cursor);
        const done = await this.jobs.whenDone(job.id);
        if (done.status !== 'done') throw new Error(done.error);
        return done.result as WbTransactionDto[];
    }
}
