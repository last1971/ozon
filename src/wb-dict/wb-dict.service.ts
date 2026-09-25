import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobService } from '../job/job.service';
import { JobStateDto } from '../job/job.state.dto';
import { emptyProgress, IJobCommand } from '../interfaces/i.job.context';
import { IWbDictContext, WbDictReport } from '../interfaces/i.wb.dict.context';
import { LoadWbCommissionsCommand } from './commands/load-wb-commissions.command';
import { LoadWbTnvedCommand } from './commands/load-wb-tnved.command';
import { BuildWbTnvedMapCommand } from './commands/build-wb-tnved-map.command';
import { WbCategoriesRepository, WbDictStats } from './wb-categories.repository';
import { WbTnvedLookup, WbTnvedMapService } from './wb-tnved-map.service';

/** Виды фоновых задач в JobService */
export const WB_DICT_CATEGORIES_JOB = 'wb-dict-categories';
export const WB_DICT_TNVED_JOB = 'wb-dict-tnved';

/**
 * Справочник ВБ: предметы с комиссиями (tariffs/commission) и ТН ВЭД по предметам
 * (directory/tnved) в WB_CATEGORIES, карта «код → предметы» для подбора предмета под наш код.
 * Две задачи, каждая — цепочка команд (commands/*), запускаются фоном через JobService,
 * как TnvedSyncService. Сервис только собирает цепочки и отвечает на поиск.
 */
@Injectable()
export class WbDictService {
    private readonly logger = new Logger(WbDictService.name);
    private readonly categoriesCommands: IJobCommand<IWbDictContext>[];
    private readonly tnvedCommands: IJobCommand<IWbDictContext>[];
    private readonly staleDays: number;

    constructor(
        private readonly jobs: JobService,
        private readonly repo: WbCategoriesRepository,
        private readonly map: WbTnvedMapService,
        config: ConfigService,
        commissions: LoadWbCommissionsCommand,
        tnved: LoadWbTnvedCommand,
        buildMap: BuildWbTnvedMapCommand,
    ) {
        // через сколько дней справочник предмета считается устаревшим и качается заново
        this.staleDays = config.get<number>('WB_TNVED_STALE_DAYS', 30);
        this.categoriesCommands = [commissions];
        this.tnvedCommands = [tnved, buildMap];
    }

    /** Предметы и комиссии с ВБ — фоном. */
    startCategories(clientId?: string): JobStateDto {
        return this.run(WB_DICT_CATEGORIES_JOB, { all: false }, this.categoriesCommands, clientId);
    }

    /** ТН ВЭД по предметам — фоном; all=true — все предметы, иначе только новые и устаревшие. */
    startTnved(all: boolean, clientId?: string): JobStateDto {
        return this.run(WB_DICT_TNVED_JOB, { all }, this.tnvedCommands, clientId);
    }

    stats(): Promise<WbDictStats> {
        return this.repo.stats(this.staleDays);
    }

    find(tnved: string): Promise<WbTnvedLookup> {
        return this.map.find(tnved);
    }

    private run(kind: string, params: { all: boolean }, commands: IJobCommand<IWbDictContext>[], clientId?: string): JobStateDto {
        return this.jobs.run<IWbDictContext, WbDictReport>({
            kind,
            params,
            clientId,
            commands,
            context: { all: params.all, days: this.staleDays, report: {}, progress: emptyProgress(), logger: this.logger },
            result: (ctx) => ctx.report,
        });
    }
}
