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
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { OzonTnvedService } from './ozon.tnved.service';
import { WbTnvedService } from './wb.tnved.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { LoadBaseTnvedCommand } from './commands/load-base-tnved.command';
import { SkipProcessedCommand } from './commands/skip-processed.command';
import { CheckTnvedCommand } from './commands/check-tnved.command';
import { BuildTnvedReportCommand } from './commands/build-tnved-report.command';
import { UpdateTnvedCommand } from './commands/update-tnved.command';
import { MarkProcessedCommand } from './commands/mark-processed.command';

export { TnvedFixItem, TnvedSyncOptions, TnvedSyncReport } from '../interfaces/i.tnved.processing.context';

/**
 * Сверка ТН ВЭД: база (истина) → маркетплейс читает и решает по каждой карточке →
 * отчёт «уже ок / на правку / нет карточки / спорно» → по команде маркетплейс пишет → отметки прогресса.
 * Каждый шаг — команда (commands/*), сервис только резолвит маркетплейс и собирает цепочку, как НДС
 * в ExtraPriceService.updateVatForAllMismatches. Про Озон и ВБ знает только договор ITnvedUpdateable.
 */
@Injectable()
export class TnvedSyncService {
    private readonly logger = new Logger(TnvedSyncService.name);
    private readonly services = new Map<GoodServiceEnum, ITnvedUpdateable>();
    private readonly chain: CommandChainAsync<ITnvedProcessingContext>;

    constructor(
        ozon: OzonTnvedService,
        wb: WbTnvedService,
        private readonly progress: ProcessedCacheService,
        config: ConfigService,
        loadBase: LoadBaseTnvedCommand,
        skipProcessed: SkipProcessedCommand,
        check: CheckTnvedCommand,
        buildReport: BuildTnvedReportCommand,
        update: UpdateTnvedCommand,
        markProcessed: MarkProcessedCommand,
    ) {
        const services = config.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON)) this.services.set(GoodServiceEnum.OZON, ozon);
        if (services.includes(GoodServiceEnum.WB)) this.services.set(GoodServiceEnum.WB, wb);
        this.chain = new CommandChainAsync<ITnvedProcessingContext>([
            loadBase,
            skipProcessed,
            check,
            buildReport,
            update,
            markProcessed,
        ]);
    }

    public getService(service: GoodServiceEnum): ITnvedUpdateable | null {
        return this.services.get(service) || null;
    }

    /** Сбросить прогресс раскатки по маркетплейсу — следующий onlyNew-прогон пойдёт с нуля. */
    async clearProgress(market: GoodServiceEnum): Promise<void> {
        await this.progress.clear(TNVED_PROGRESS_CACHE, market);
    }

    async sync(opts: TnvedSyncOptions): Promise<TnvedSyncReport> {
        const service = this.getService(opts.market);
        if (!service) {
            throw new BadRequestException(
                `маркетплейс «${opts.market}» не поддерживает ТН ВЭД; доступны: ${[...this.services.keys()].join(', ') || 'нет'}`,
            );
        }

        const { report } = await this.chain.execute({ service, opts, logger: this.logger });

        this.logger.log(
            `[tnved-sync] ${opts.market} apply=${report.apply} goods=${report.checkedGoods} offers=${report.checkedOffers} ` +
                `toFix=${report.toFix.length} ok=${report.alreadyOk} notFound=${report.notFoundOnOzon.length} ` +
                `ambiguous=${report.ambiguous.length}`,
        );
        return report;
    }
}
