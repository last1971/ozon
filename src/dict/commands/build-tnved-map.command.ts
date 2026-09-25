import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IDictContext } from '../../interfaces/i.tnved.dictionary';
import { TnvedMapService } from '../tnved-map.service';

/** Пересобрать карту «код → предметы» рынка из базы после выкачки. */
@Injectable()
export class BuildTnvedMapCommand implements IJobCommand<IDictContext> {
    readonly phase = 'карта';

    constructor(private readonly map: TnvedMapService) {}

    async execute(context: IDictContext): Promise<IDictContext> {
        context.report.codes = await this.map.rebuild(context.service);
        return context;
    }
}
