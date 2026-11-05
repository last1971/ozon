import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { emptyProgress, IJobCommand } from '../../interfaces/i.job.context';
import { JobService } from '../../job/job.service';
import { JobStateDto } from '../../job/job.state.dto';
import { ReadTariffFileCommand } from './read-tariff-file.command';
import { ValidateTariffFileCommand } from './validate-tariff-file.command';
import { ParseTariffRowsCommand } from './parse-tariff-rows.command';
import { WriteTariffsCommand } from './write-tariffs.command';
import { SaveTariffDateCommand } from './save-tariff-date.command';
import { TariffImportContext, TariffImportResult, TariffKind, tariffImportJob } from './tariff-import.context';

@Injectable()
export class TariffImportService {
    private readonly logger = new Logger(TariffImportService.name);
    private readonly commands: IJobCommand<TariffImportContext>[];
    constructor(
        private readonly jobs: JobService,
        read: ReadTariffFileCommand,
        validate: ValidateTariffFileCommand,
        parse: ParseTariffRowsCommand,
        write: WriteTariffsCommand,
        saveDate: SaveTariffDateCommand,
    ) {
        this.commands = [read, validate, parse, write, saveDate];
    }
    start(kind: TariffKind, buffer: Buffer, filename: string, clientId?: string): JobStateDto {
        return this.jobs.run<TariffImportContext, TariffImportResult>({
            kind: tariffImportJob(kind),
            params: { filename, hash: createHash('sha256').update(buffer).digest('hex') },
            clientId,
            commands: this.commands,
            context: { kind, buffer, filename, progress: emptyProgress(), logger: this.logger },
            result: (context) => context.result,
            cleanup: (context) => this.cleanup(context),
            canCancel: (context) => !context.committing,
        });
    }
    /** Прежние серверные вызовы ждут эту же цепочку; HTTP возвращает start(). */
    async import(kind: TariffKind, buffer: Buffer, filename: string): Promise<TariffImportResult> {
        const result = await this.jobs.whenDone(this.start(kind, buffer, filename).id);
        if (result.status === 'failed') throw new Error(result.error);
        return result.result as TariffImportResult;
    }
    private async cleanup(context: TariffImportContext): Promise<void> {
        try {
            if (context.transaction) await context.transaction.rollback(true);
        } finally {
            context.transaction = undefined;
            context.buffer = undefined;
            context.workbook = undefined;
            context.layouts = undefined;
            context.commissions = undefined;
            context.logistics = undefined;
        }
    }
}
