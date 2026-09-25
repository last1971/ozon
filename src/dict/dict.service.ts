import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { JobService } from '../job/job.service';
import { JobStateDto } from '../job/job.state.dto';
import { emptyProgress, IJobCommand } from '../interfaces/i.job.context';
import { DictReport, DictStats, IDictContext, ITnvedDictionary } from '../interfaces/i.tnved.dictionary';
import { LoadCategoriesCommand } from './commands/load-categories.command';
import { LoadTnvedCommand } from './commands/load-tnved.command';
import { BuildTnvedMapCommand } from './commands/build-tnved-map.command';
import { TnvedLookup, TnvedMapService } from './tnved-map.service';
import { WbDictService } from './wb.dict.service';
import { OzonDictService } from './ozon.dict.service';

/** Виды фоновых задач в JobService */
export const DICT_CATEGORIES_JOB = 'dict-categories';
export const DICT_TNVED_JOB = 'dict-tnved';

/**
 * Справочники маркетплейсов: предметы с комиссиями и ТН ВЭД по предметам, карта «код → предметы».
 * Рынки — реализации ITnvedDictionary, зарегистрированные по SERVICES (как в TnvedSyncService);
 * команды одни на всех, рынок приходит в контексте. Две задачи фоном через JobService;
 * поиск и счётчики — по всем зарегистрированным рынкам сразу.
 */
@Injectable()
export class DictService {
    private readonly logger = new Logger(DictService.name);
    private readonly services = new Map<GoodServiceEnum, ITnvedDictionary>();
    private readonly categoriesCommands: IJobCommand<IDictContext>[];
    private readonly tnvedCommands: IJobCommand<IDictContext>[];
    private readonly staleDays: number;

    constructor(
        private readonly jobs: JobService,
        private readonly map: TnvedMapService,
        config: ConfigService,
        wb: WbDictService,
        ozon: OzonDictService,
        categories: LoadCategoriesCommand,
        tnved: LoadTnvedCommand,
        buildMap: BuildTnvedMapCommand,
    ) {
        const services = config.get<GoodServiceEnum[]>('SERVICES', []);
        for (const service of [ozon, wb]) {
            if (services.includes(service.market)) this.services.set(service.market, service);
        }
        // через сколько дней справочник предмета считается устаревшим и качается заново
        this.staleDays = config.get<number>('WB_TNVED_STALE_DAYS', 30);
        this.categoriesCommands = [categories];
        this.tnvedCommands = [tnved, buildMap];
    }

    markets(): GoodServiceEnum[] {
        return [...this.services.keys()];
    }

    /** Предметы и комиссии с маркетплейса — фоном. */
    startCategories(market: GoodServiceEnum, clientId?: string): JobStateDto {
        return this.run(DICT_CATEGORIES_JOB, this.requireService(market), false, this.categoriesCommands, clientId);
    }

    /** ТН ВЭД по предметам — фоном; all=true — все предметы, иначе только новые и устаревшие. */
    startTnved(market: GoodServiceEnum, all: boolean, clientId?: string): JobStateDto {
        return this.run(DICT_TNVED_JOB, this.requireService(market), all, this.tnvedCommands, clientId);
    }

    stats(): Promise<DictStats[]> {
        return Promise.all([...this.services.values()].map((s) => s.stats(this.staleDays)));
    }

    /** Поиск по всем рынкам сразу: у каждого свой ответ, порядок — как зарегистрированы. */
    find(tnved: string): Promise<TnvedLookup[]> {
        return Promise.all([...this.services.values()].map((s) => this.map.find(s, tnved)));
    }

    private requireService(market: GoodServiceEnum): ITnvedDictionary {
        const service = this.services.get(market);
        if (!service) {
            throw new BadRequestException(
                `маркетплейс «${market}» без справочника; доступны: ${this.markets().join(', ') || 'нет'}`,
            );
        }
        return service;
    }

    private run(kind: string, service: ITnvedDictionary, all: boolean, commands: IJobCommand<IDictContext>[], clientId?: string): JobStateDto {
        return this.jobs.run<IDictContext, DictReport>({
            kind,
            params: { market: service.market, all },
            clientId,
            commands,
            context: {
                service,
                all,
                days: this.staleDays,
                report: { market: service.market },
                progress: emptyProgress(),
                logger: this.logger,
            },
            result: (ctx) => ctx.report,
        });
    }
}
