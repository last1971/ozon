import {
    PRICING_INPUTS_CHANGED,
    PricingInputsChanged,
    matchesPricingInputs,
    mergePricingInputs,
} from '../../helpers/price/pricing-inputs-changed';
import { lossPriceRetryDue } from './loss-price.retry';
import { MpEventRowDto } from '../../mp-event/mp-event.service';
import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JobService } from '../../job/job.service';
import { emptyProgress, IJobCommand } from '../../interfaces/i.job.context';
import { JobStateDto } from '../../job/job.state.dto';
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
    private readonly wakes = new Map<LossPriceMarket, PricingInputsChanged>();
    private readonly contexts = new Map<LossPriceMarket, LossPriceContext>();
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
        const forceRetry = clientId !== 'cron' && clientId !== 'loss-saved';
        const active = this.active.get(key);
        if (active) {
            if (forceRetry) {
                const context = this.contexts.get(key);
                context.forceRetry = true;
                if (context.tasks.some((task) => task.deferred)) {
                    this.wakes.set(key, {});
                    this.rerun.add(key);
                }
            }
            return this.jobs.get(active);
        }
        assertPricingWritesAllowed();
        const context: LossPriceContext = {
            service: key,
            adapter: this.adapters[key],
            tasks: [],
            sent: 0,
            forceRetry,
            wake: this.wakes.get(key),
            progress: { ...emptyProgress(), phase: 'Ожидание очереди обновления цен' },
        };
        this.wakes.delete(key);
        this.contexts.set(key, context);
        const job = this.jobs.run<LossPriceContext, unknown>({
            kind: lossPriceJobKind(key),
            params: {},
            clientId,
            context,
            commands: this.commands,
            cleanup: async () => {},
            result: (c) => ({
                service: key,
                processed: c.tasks.filter((task) => !task.deferred).length,
                sent: c.sent,
                completed: c.tasks.filter((t) => !t.error).length,
                pending: c.tasks
                    .filter((t) => t.error)
                    .map((t) => ({ offerId: t.offerId, error: t.error, ...(t.deferred ? { deferred: true } : {}) })),
            }),
        });
        this.active.set(key, job.id);
        void this.jobs.whenDone(job.id).then((done) => {
            this.active.delete(key);
            this.contexts.delete(key);
            if (done.status !== 'done' && (context.wake || context.forceRetry))
                this.wakes.set(key, mergePricingInputs(this.wakes.get(key), context.wake ?? {}));
            // Новый снимок или сигнал об исправлении данных не теряются во время текущего прохода.
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
            this.start(key, 'loss-saved');
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
            try {
                this.start(service, 'bootstrap');
            } catch (error) {
                this.logger.error(`Восстановление очереди цен: ${error.message}`);
            }
        }
    }
    hasReady(service: string, rows: MpEventRowDto[]): boolean {
        const key = this.require(service);
        return rows.some((row) => lossPriceRetryDue(row.payload, false, this.wakes.get(key)));
    }
    @OnEvent('counts.changed')
    countsChanged(goods: { code: string | number }[]) {
        this.inputsChanged({ codes: goods.map((good) => String(good.code)) });
    }
    @OnEvent(PRICING_INPUTS_CHANGED)
    inputsChanged(change: PricingInputsChanged) {
        for (const service of Object.keys(this.adapters)) {
            let key: LossPriceMarket;
            try {
                key = this.require(service);
            } catch {
                continue;
            }
            if (change.service && change.service !== key) continue;
            this.wakes.set(key, mergePricingInputs(this.wakes.get(key), change));
            const context = this.contexts.get(key);
            if (context?.tasks.some((task) => task.error && matchesPricingInputs(task.offerId, change)))
                this.rerun.add(key);
        }
    }
}
