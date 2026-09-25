import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IWbDictContext } from '../../interfaces/i.wb.dict.context';
import { WbTnvedMapService } from '../wb-tnved-map.service';

/** Пересобрать карту «код → предметы» из базы после выкачки. */
@Injectable()
export class BuildWbTnvedMapCommand implements IJobCommand<IWbDictContext> {
    readonly phase = 'карта';

    constructor(private readonly map: WbTnvedMapService) {}

    async execute(context: IWbDictContext): Promise<IWbDictContext> {
        context.report.codes = await this.map.rebuild();
        return context;
    }
}
