import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { GoodServiceEnum } from '../good/good.service.enum';
import { JobService } from '../job/job.service';
import { emptyProgress } from '../interfaces/i.job.context';
import { WbMinPriceCheckCommand, WbMinPriceContext } from './wb-min-price-check.command';
import { WbBulkPriceReport } from './wb.price.service';

/** Отчёт сторожа, когда он что-то поменял (NotifierService → тема «цены»). */
export const WB_MIN_PRICES_EVENT = 'wb.min.prices';

/**
 * Сторож минимальной цены ВБ (решение владельца 23.10.2026: покупатель видит минимальную).
 * Зовёт ту же ручку, что и руками (`wb/min-price` без артикулов), по всем карточкам кабинета:
 * акция ВБ, задравшая скидку, откатывается, цена выше минимальной опускается.
 * Сообщает, только если поменял: «нет минимальной в базе» повторялось бы каждый прогон.
 */
@Injectable()
export class WbMinPriceGuard {
    private readonly logger = new Logger(WbMinPriceGuard.name);
    private running = false;

    constructor(
        private readonly config: ConfigService,
        private readonly events: EventEmitter2,
        private readonly jobs: JobService,
        private readonly check: WbMinPriceCheckCommand,
    ) {}

    // Боевое время задаёт cron.setup.ts: раз в час на 9-й минуте, отдельно от сверки Ozon.
    @Cron('0 9 * * * *', { name: 'wbHoldMinPrices' })
    async run(): Promise<void> {
        if (this.running || !this.config.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.WB)) return;
        this.running = true;
        try {
            const job = this.jobs.run<WbMinPriceContext, WbBulkPriceReport>({
                kind: 'wb-min-price-guard',
                params: {},
                clientId: 'cron',
                measure: true,
                context: { progress: emptyProgress(), logger: this.logger },
                commands: [this.check],
                cleanup: async () => {},
                result: (ctx) => ctx.report,
            });
            const done = await this.jobs.whenDone(job.id);
            if (done.status !== 'done') throw new Error(done.error || 'Проверка ВБ не завершена');
            const report = done.result as WbBulkPriceReport;
            this.logger.log(
                `Проверка ВБ: ${report.total ?? 0} товаров, ошибок ${report.errors.length}; ${Date.parse(done.finishedAt) - Date.parse(done.startedAt)} мс`,
            );
            if (!report.toUpdate) return;
            this.logger.log(
                `ВБ к минимальной: изменено ${report.toUpdate}, база ниже минимальной ${report.belowMin.length}, ` +
                    `задача ${report.uploadId ?? '—'}`,
            );
            this.events.emit(WB_MIN_PRICES_EVENT, report);
        } catch (e) {
            this.logger.error(`ВБ к минимальной не выполнено — ${(e as Error).message}`);
        } finally {
            this.running = false;
        }
    }
}
