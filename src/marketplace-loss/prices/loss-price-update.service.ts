import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JobService } from '../../job/job.service';
import { emptyProgress, IJobCommand } from '../../interfaces/i.job.context';
import { JobStateDto } from '../../job/job.state.dto';
import { priceUpdateQueue } from '../../helpers/price/price-update.queue';
import { assertPricingWritesAllowed } from '../../helpers/price/pricing-review-mode';
import {
    LOSS_PRICE_ADAPTERS,
    LOSS_SAVED_EVENT,
    LossPriceAdapter,
    LossPriceContext,
    LossPriceMarket,
    lossPriceJobKind,
    lossPriceMarket,
} from './loss-price.contracts';
import {
    LoadLossPriceTasksCommand,
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
    FinishLossPriceTasksCommand,
} from './loss-price.commands';

@Injectable()
export class LossPriceUpdateService implements OnApplicationBootstrap {
    private readonly logger = new Logger(LossPriceUpdateService.name);
    private readonly active = new Map<LossPriceMarket, string>();
    private readonly rerun = new Set<LossPriceMarket>();
    private readonly commands: IJobCommand<LossPriceContext>[];
    constructor(
        private readonly config: ConfigService,
        private readonly jobs: JobService,
        @Inject(LOSS_PRICE_ADAPTERS) private readonly adapters: Record<LossPriceMarket, LossPriceAdapter>,
        load: LoadLossPriceTasksCommand,
        calculate: CalculateLossPriceTargetsCommand,
        compare: CompareLossPricesCommand,
        send: SendLossPricesCommand,
        confirm: ConfirmLossPricesCommand,
        promos: CheckLossPricePromosCommand,
        finish: FinishLossPriceTasksCommand,
    ) {
        this.commands = [load, calculate, compare, send, confirm, promos, finish];
    }
    require(service: string): LossPriceMarket {
        let key: LossPriceMarket;
        try {
            key = lossPriceMarket(service);
        } catch (e) {
            throw new BadRequestException(e.message);
        }
        const configured = this.config.get<string[] | string>('SERVICES', []);
        const services = (Array.isArray(configured) ? configured : configured.split(',')).map((s) =>
            s.trim().toUpperCase(),
        );
        if (!services.includes(key) || !this.adapters[key])
            throw new BadRequestException('Площадка не подключена к кабинету');
        return key;
    }
    start(service: string, clientId?: string): JobStateDto {
        const key = this.require(service);
        const active = this.active.get(key);
        if (active) return this.jobs.get(active);
        assertPricingWritesAllowed();
        const job = this.jobs.run<LossPriceContext, unknown>({
            kind: lossPriceJobKind(key),
            params: {},
            clientId,
            context: {
                service: key,
                adapter: this.adapters[key],
                tasks: [],
                sent: 0,
                progress: { ...emptyProgress(), phase: 'Ожидание очереди обновления цен' },
            },
            commands: this.commands,
            execute: (run) => priceUpdateQueue.run(key.toLowerCase(), run),
            cleanup: async () => {},
            result: (c) => ({
                service: key,
                processed: c.tasks.length,
                sent: c.sent,
                completed: c.tasks.filter((t) => !t.error).length,
                pending: c.tasks.filter((t) => t.error).map((t) => ({ offerId: t.offerId, error: t.error })),
            }),
        });
        this.active.set(key, job.id);
        void this.jobs.whenDone(job.id).then(() => {
            this.active.delete(key);
            // Только новый сохранённый снимок вызывает немедленный следующий проход. Ошибки ждут повтора.
            if (this.rerun.delete(key)) this.saved(key);
        });
        return job;
    }
    @OnEvent(LOSS_SAVED_EVENT)
    saved(service: string) {
        try {
            const key = this.require(service);
            if (this.active.has(key)) {
                this.rerun.add(key);
                return;
            }
            this.start(key);
        } catch (e) {
            this.logger.error(`Задания цен остались в очереди: ${e.message}`);
        }
    }
    onApplicationBootstrap() {
        // Без нового cron: восстановить сохранённые задания после перезапуска.
        for (const service of Object.keys(this.adapters)) {
            try {
                this.require(service);
            } catch {
                continue;
            }
            this.saved(service);
        }
    }
}
