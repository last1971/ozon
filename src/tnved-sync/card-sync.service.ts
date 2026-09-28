import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ITnvedUpdateable } from '../interfaces/i.tnved.updateable';
import { TNVED_PROGRESS_CACHE } from '../interfaces/i.tnved.processing.context';
import { CardSyncMode, CardSyncOptions, CardSyncReport, ICardSyncable, ICardSyncContext } from '../interfaces/i.card.sync';
import { GTIN_PROGRESS_CACHE } from '../interfaces/i.gtin.sync';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';
import { OzonGtinService } from './ozon.gtin.service';
import { WbGtinService } from './wb.gtin.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { LoadBaseTnvedCommand } from './commands/load-base-tnved.command';
import { LoadBaseGtinCommand } from './commands/load-base-gtin.command';
import { SkipProcessedCommand } from './commands/skip-processed.command';
import { CheckCardsCommand } from './commands/check-cards.command';
import { BuildSyncReportCommand } from './commands/build-sync-report.command';
import { UpdateCardsCommand } from './commands/update-cards.command';
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
export const GTIN_SYNC_JOB = 'gtin-sync';

/** Что нужно режиму: вид задачи, набор прогресса, маркетплейсы-реализации, цепочка (своя только загрузка базы). */
interface ModeSetup {
    title: string;
    kind: string;
    progressCache: string;
    services: Map<GoodServiceEnum, ICardSyncable<any, any>>;
    commands: IJobCommand<ICardSyncContext<any, any>>[];
}

/**
 * Сверка карточек маркетплейса с базой по режимам (ТН ВЭД, GTIN): база (истина) → маркетплейс читает и решает
 * по каждой карточке → отчёт «уже ок / на правку / нет карточки / спорно» → по команде маркетплейс пишет →
 * отметки прогресса. Каждый шаг — команда (commands/*); общие у всех режимов, своя у режима только загрузка базы.
 * Про Озон и ВБ знает только договор ICardSyncable. У режимов разные виды задач — идут независимо; запись
 * карточек ВБ всё равно одна очередь (WbCardWriter).
 * start() — в фоне, состояние по id через /api/job; sync() — дождаться и вернуть отчёт (тесты, curl).
 */
@Injectable()
export class CardSyncService {
    private readonly logger = new Logger(CardSyncService.name);
    private readonly modes = new Map<CardSyncMode, ModeSetup>();
    private readonly tnvedServices: Map<GoodServiceEnum, ITnvedUpdateable>;
    private readonly missingCommands: IJobCommand<IMissingTnvedContext>[];

    constructor(
        ozonTnved: OzonTnvedService,
        wbTnved: WbTnvedService,
        ozonGtin: OzonGtinService,
        wbGtin: WbGtinService,
        private readonly progress: ProcessedCacheService,
        private readonly jobs: JobService,
        config: ConfigService,
        loadBaseTnved: LoadBaseTnvedCommand,
        loadBaseGtin: LoadBaseGtinCommand,
        skipProcessed: SkipProcessedCommand,
        check: CheckCardsCommand,
        buildReport: BuildSyncReportCommand,
        update: UpdateCardsCommand,
        markProcessed: MarkProcessedCommand,
        loadOffers: LoadMarketOffersCommand,
        loadGoods: LoadBaseGoodsCommand,
        diff: DiffMissingTnvedCommand,
    ) {
        const enabled = config.get<GoodServiceEnum[]>('SERVICES', []);
        const pick = <S>(pairs: [GoodServiceEnum, S][]) => new Map(pairs.filter(([market]) => enabled.includes(market)));
        const tail = [skipProcessed, check, buildReport, update, markProcessed];

        this.tnvedServices = pick<ITnvedUpdateable>([
            [GoodServiceEnum.OZON, ozonTnved],
            [GoodServiceEnum.WB, wbTnved],
        ]);
        this.modes.set(CardSyncMode.TNVED, {
            title: 'ТН ВЭД',
            kind: TNVED_SYNC_JOB,
            progressCache: TNVED_PROGRESS_CACHE,
            services: this.tnvedServices,
            commands: [loadBaseTnved, ...tail],
        });
        this.modes.set(CardSyncMode.GTIN, {
            title: 'GTIN',
            kind: GTIN_SYNC_JOB,
            progressCache: GTIN_PROGRESS_CACHE,
            services: pick<ICardSyncable<any, any>>([
                [GoodServiceEnum.OZON, ozonGtin],
                [GoodServiceEnum.WB, wbGtin],
            ]),
            commands: [loadBaseGtin, ...tail],
        });
        this.missingCommands = [loadOffers, loadGoods, diff];
    }

    public getService(market: GoodServiceEnum, mode: CardSyncMode = CardSyncMode.TNVED): ICardSyncable<any, any> | null {
        return this.modes.get(mode)?.services.get(market) || null;
    }

    /** Сбросить прогресс раскатки режима по маркетплейсу — следующий onlyNew-прогон пойдёт с нуля. */
    async clearProgress(market: GoodServiceEnum, mode: CardSyncMode = CardSyncMode.TNVED): Promise<void> {
        await this.progress.clear(this.requireMode(mode).progressCache, market);
    }

    private requireMode(mode: CardSyncMode): ModeSetup {
        const setup = this.modes.get(mode);
        if (!setup) throw new BadRequestException(`режим «${mode}» неизвестен; доступны: ${[...this.modes.keys()].join(', ')}`);
        return setup;
    }

    private requireService<S>(services: Map<GoodServiceEnum, S>, market: GoodServiceEnum, title: string): S {
        const service = services.get(market);
        if (!service) {
            throw new BadRequestException(
                `маркетплейс «${market}» не поддерживает ${title}; доступны: ${[...services.keys()].join(', ') || 'нет'}`,
            );
        }
        return service;
    }

    /** «Где у нас пусто»: карточки маркетплейса, у которых в базе ТН ВЭД пуст или товара нет вообще. Фоном. */
    startMissing(market: GoodServiceEnum, clientId?: string): JobStateDto {
        const service = this.requireService(this.tnvedServices, market, 'ТН ВЭД');
        return this.jobs.run<IMissingTnvedContext, MissingTnvedReport>({
            kind: TNVED_MISSING_JOB,
            params: { market },
            clientId,
            commands: this.missingCommands,
            context: { market, service, progress: emptyProgress(), logger: this.logger },
            result: (ctx) => ctx.report,
        });
    }

    /** Запустить сверку режима в фоне. Та же задача с теми же параметрами уже идёт — вернётся она. */
    start(opts: CardSyncOptions, clientId?: string): JobStateDto {
        const mode = opts.mode ?? CardSyncMode.TNVED;
        const setup = this.requireMode(mode);
        const service = this.requireService(setup.services, opts.market, setup.title);
        const fullOpts: CardSyncOptions = { ...opts, mode };
        return this.jobs.run<ICardSyncContext<any, any>, CardSyncReport>({
            kind: setup.kind,
            params: { ...fullOpts },
            clientId,
            commands: setup.commands,
            context: { service, opts: fullOpts, progressCache: setup.progressCache, progress: emptyProgress(), logger: this.logger },
            result: (ctx) => ctx.report,
        });
    }

    /** Запустить и дождаться. */
    async sync(opts: CardSyncOptions): Promise<CardSyncReport<any>> {
        const state = await this.jobs.whenDone(this.start(opts).id);
        if (state.status === 'failed') throw new Error(state.error);
        const report = state.result as CardSyncReport<any>;

        this.logger.log(
            `[${opts.mode ?? CardSyncMode.TNVED}-sync] ${opts.market} apply=${report.apply} goods=${report.checkedGoods} ` +
                `offers=${report.checkedOffers} toFix=${report.toFix.length} ok=${report.alreadyOk} ` +
                `notFound=${report.notFoundOnOzon.length} ambiguous=${report.ambiguous.length}`,
        );
        return report;
    }
}
