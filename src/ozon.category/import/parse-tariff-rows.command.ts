import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { CommissionLayout, LogisticsLayout, parseCommissionRows, parseLogisticsRows } from '../tariff.xlsx';
import { TariffImportContext } from './tariff-import.context';

@Injectable()
export class ParseTariffRowsCommand implements IJobCommand<TariffImportContext> {
    readonly phase = 'разбор строк';
    readonly weight = 25;
    async execute(context: TariffImportContext): Promise<TariffImportContext> {
        await jobCheckpoint(context);
        const checkpoint = () => jobCheckpoint(context);
        if (context.kind === 'commissions')
            context.commissions = await parseCommissionRows(
                context.layouts[0] as CommissionLayout,
                context.progress,
                checkpoint,
            );
        else
            context.logistics = await parseLogisticsRows(
                context.layouts as LogisticsLayout[],
                context.progress,
                checkpoint,
            );
        context.progress.counters.rows = (context.commissions ?? context.logistics).length;
        return context;
    }
}
