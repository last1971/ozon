import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { JobService } from '../job/job.service';
import { JobStateDto } from '../job/job.state.dto';
import { pricingReviewMode } from '../helpers/price/pricing-review-mode';
import { LossMarketsService } from './loss-markets.service';
import { LossPriceQueueStore } from './prices/loss-price-queue.store';
import { LossPriceUpdateService } from './prices/loss-price-update.service';
import { LossPriceMarket, lossPriceJobKind } from './prices/loss-price.contracts';

/** Только расписание. Источники, команды, дедупликация и прогресс принадлежат готовым сервисам. */
@Injectable()
export class LossScheduleService {
    private readonly logger = new Logger(LossScheduleService.name);
    constructor(
        private readonly config: ConfigService,
        private readonly markets: LossMarketsService,
        private readonly prices: LossPriceUpdateService,
        private readonly queue: LossPriceQueueStore,
        private readonly jobs: JobService,
    ) {}
    // Ozon сохраняет прежний единственный запуск ozonReturnPerc в 05:38, Europe/Moscow.
    @Cron('0 8 6 * * *', { name: 'wbLossStats', timeZone: 'Europe/Moscow' })
    dailyWb(): Promise<void> {
        return this.daily('WB');
    }

    @Cron('0 38 6 * * *', { name: 'yandexLossStats', timeZone: 'Europe/Moscow' })
    dailyYandex(): Promise<void> {
        return this.daily('YANDEX');
    }

    private async daily(service: string): Promise<void> {
        if (!this.production() || !this.markets.list().some((market) => market.service === service)) return;
        try {
            // Ручной и суточный запуск обращаются к одной цепочке и одному JobService.
            const done = await this.completed(this.markets.start(service, 'cron'));
            this.logger.log(`Статистика ${service}: сохранено ${(done.result as { rows?: number })?.rows ?? 0} строк`);
        } catch (error) {
            this.logger.error(`Статистика ${service} не обновлена: ${error.message}`);
        }
    }

    @Cron('0 6/10 * * * *', { name: 'marketplaceLossPriceRetry', timeZone: 'Europe/Moscow' })
    async retryPrices(): Promise<void> {
        if (!this.production() || pricingReviewMode()) return;
        const services = this.markets
            .list()
            .map((market) => market.service)
            .filter((service): service is LossPriceMarket => service === 'OZON' || service === 'WB');
        // Независимые площадки не ждут друг друга; свои записи по-прежнему сериализует priceUpdateQueue.
        await Promise.all(services.map((service) => this.retry(service)));
    }
    private async retry(service: LossPriceMarket): Promise<void> {
        try {
            if (this.jobs.list(lossPriceJobKind(service)).some((job) => job.status === 'running')) return;
            if (!(await this.queue.pending(service)).length) return;
            const done = await this.completed(this.prices.start(service, 'cron'));
            const report = done.result as { completed?: number; pending?: unknown[] };
            this.logger.log(
                `Очередь цен ${service}: завершено ${report?.completed ?? 0}, осталось в проходе ${report?.pending?.length ?? 0}`,
            );
        } catch (error) {
            this.logger.error(`Повтор цен ${service} не завершён; задания остаются в базе: ${error.message}`);
        }
    }
    private production(): boolean {
        return this.config.get('NODE_ENV') === 'production';
    }
    private async completed(job: JobStateDto): Promise<JobStateDto> {
        const done = await this.jobs.whenDone(job.id);
        if (done.status !== 'done') throw new Error(done.error || 'Задача не завершена');
        return done;
    }
}
