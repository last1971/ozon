import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { readTariffWorkbook, sourceMetadata } from '../tariff.xlsx';
import { TariffImportContext } from './tariff-import.context';

@Injectable()
export class ReadTariffFileCommand implements IJobCommand<TariffImportContext> {
    readonly phase = 'чтение файла';
    readonly weight = 10;
    async execute(context: TariffImportContext): Promise<TariffImportContext> {
        await jobCheckpoint(context);
        context.progress.total = 1;
        context.meta = sourceMetadata(context.buffer, context.filename);
        context.workbook = await readTariffWorkbook(context.buffer);
        context.progress.done = 1;
        return context;
    }
}
