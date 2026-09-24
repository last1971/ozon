import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ITnvedUpdateable } from '../interfaces/i.tnved.updateable';
import {
    ITnvedProcessingContext,
    TNVED_PROGRESS_CACHE,
    TnvedSyncOptions,
    TnvedSyncReport,
} from '../interfaces/i.tnved.processing.context';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { LoadBaseTnvedCommand } from './commands/load-base-tnved.command';
import { SkipProcessedCommand } from './commands/skip-processed.command';
import { CheckTnvedCommand } from './commands/check-tnved.command';
import { BuildTnvedReportCommand } from './commands/build-tnved-report.command';
import { UpdateTnvedCommand } from './commands/update-tnved.command';
import { MarkProcessedCommand } from './commands/mark-processed.command';
import { LoadMarketOffersCommand } from './commands/load-market-offers.command';
import { LoadBaseGoodsCommand } from './commands/load-base-goods.command';
import { DiffMissingTnvedCommand } from './commands/diff-missing-tnved.command';
import { IMissingTnvedContext, MissingTnvedReport } from '../interfaces/i.missing.tnved.context';
import { JobService } from '../job/job.service';
import { JobStateDto } from '../job/job.state.dto';
import { emptyProgress, IJobCommand } from '../interfaces/i.job.context';

export { TnvedFixItem, TnvedSyncOptions, TnvedSyncReport } from '../interfaces/i.tnved.processing.context';

/** Виды фоновых задач в JobService */
export const TNVED_SYNC_JOB = 'tnved-sync';
export const TNVED_MISSING_JOB = 'tnved-missing';

/**
 * Сверка ТН ВЭД: база (истина) → маркетплейс читает и решает по каждой карточке →
 * отчёт «уже ок / на правку / нет карточки / спорно» → по команде маркетплейс пишет → отметки прогресса.
 * Каждый шаг — команда (commands/*), сервис только резолвит маркетплейс и отдаёт цепочку JobService,
 * как НДС в ExtraPriceService.updateVatForAllMismatches. Про Озон и ВБ знает только договор ITnvedUpdateable.
 * start() — в фоне, состояние по id через /api/job; sync() — дождаться и вернуть отчёт (тесты, curl).
 */
@Injectable()
export class TnvedSyncService {
    private readonly logger = new Logger(TnvedSyncService.name);
    private readonly services = new Map<GoodServiceEnum, ITnvedUpdateable>();
    private readonly commands: IJobCommand<ITnvedProcessingContext>[];
    private readonly missingCommands: IJobCommand<IMissingTnvedContext>[];

    constructor(
        ozon: OzonTnvedService,
        wb: WbTnvedService,
        private readonly progress: ProcessedCacheService,
        private readonly jobs: JobService,
        config: ConfigService,
        loadBase: LoadBaseTnvedCommand,
        skipProcessed: SkipProcessedCommand,
        check: CheckTnvedCommand,
        buildReport: BuildTnvedReportCommand,
        update: UpdateTnvedCommand,
        markProcessed: MarkProcessedCommand,
        loadOffers: LoadMarketOffersCommand,
        loadGoods: LoadBaseGoodsCommand,
        diff: DiffMissingTnvedCommand,
    ) {
        const services = config.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON)) this.services.set(GoodServiceEnum.OZON, ozon);
        if (services.includes(GoodServiceEnum.WB)) this.services.set(GoodServiceEnum.WB, wb);
        this.commands = [loadBase, skipProcessed, check, buildReport, update, markProcessed];
        this.missingCommands = [loadOffers, loadGoods, diff];
    }

    public getService(service: GoodServiceEnum): ITnvedUpdateable | null {
        return this.services.get(service) || null;
    }

    /** Сбросить прогресс раскатки по маркетплейсу — следующий onlyNew-прогон пойдёт с нуля. */
    async clearProgress(market: GoodServiceEnum): Promise<void> {
        await this.progress.clear(TNVED_PROGRESS_CACHE, market);
    }

    private requireService(market: GoodServiceEnum): ITnvedUpdateable {
        const service = this.getService(market);
        if (!service) {
            throw new BadRequestException(
                `маркетплейс «${market}» не поддерживает ТН ВЭД; доступны: ${[...this.services.keys()].join(', ') || 'нет'}`,
            );
        }
        return service;
    }

    /** «Где у нас пусто»: карточки маркетплейса, у которых в базе ТН ВЭД пуст или товара нет вообще. Фоном. */
    startMissing(market: GoodServiceEnum, clientId?: string): JobStateDto {
        const service = this.requireService(market);
        return this.jobs.run<IMissingTnvedContext, MissingTnvedReport>({
            kind: TNVED_MISSING_JOB,
            params: { market },
            clientId,
            commands: this.missingCommands,
            context: { market, service, progress: emptyProgress(), logger: this.logger },
            result: (ctx) => ctx.report,
        });
    }

    /** Запустить сверку в фоне. Та же задача с теми же параметрами уже идёт — вернётся она. */
    start(opts: TnvedSyncOptions, clientId?: string): JobStateDto {
        const service = this.requireService(opts.market);
        return this.jobs.run<ITnvedProcessingContext, TnvedSyncReport>({
            kind: TNVED_SYNC_JOB,
            params: { ...opts },
            clientId,
            commands: this.commands,
            context: { service, opts, progress: emptyProgress(), logger: this.logger },
            result: (ctx) => ctx.report,
        });
    }

    /** Запустить и дождаться. */
    async sync(opts: TnvedSyncOptions): Promise<TnvedSyncReport> {
        const state = await this.jobs.whenDone(this.start(opts).id);
        if (state.status === 'failed') throw new Error(state.error);
        const report = state.result as TnvedSyncReport;

        this.logger.log(
            `[tnved-sync] ${opts.market} apply=${report.apply} goods=${report.checkedGoods} offers=${report.checkedOffers} ` +
                `toFix=${report.toFix.length} ok=${report.alreadyOk} notFound=${report.notFoundOnOzon.length} ` +
                `ambiguous=${report.ambiguous.length}`,
        );
        return report;
    }
}
