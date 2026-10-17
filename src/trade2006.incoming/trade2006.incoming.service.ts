import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { IncomingContext } from './incoming.types';
import { LoadPendingIncomingCommand } from './commands/load-pending-incoming.command';
import { LoadIncomingGoodsCommand } from './commands/load-incoming-goods.command';
import { RepriceIncomingGoodsCommand } from './commands/reprice-incoming-goods.command';
import { MarkIncomingHandledCommand } from './commands/mark-incoming-handled.command';

/**
 * Приход товара в Trade → пересчёт цен на площадках.
 *
 * Событие рождает сама база: триггер на строке прихода (SKLADIN/SHOPIN, патч 62) кладёт в журнал
 * MP_EVENT заявку «приход NP, pending» — один документ = одна заявка, сколько бы строк ни ввели.
 * Delphi по сети никуда не ходит, как и с пачками ЧЗ. Крон раз в 10 минут берёт заявки, к которым
 * INCOMING_SETTLED_MINUTES минут никто не прикасался (приход ещё набивают — ждём), собирает коды
 * товаров и прогоняет цепочку прихода из цен. Очередь переживает рестарт узла; упавший проход
 * оставляет заявки на следующий.
 */
@Injectable()
export class Trade2006IncomingService {
    private readonly logger = new Logger(Trade2006IncomingService.name);
    private running = false;

    constructor(
        private readonly configService: ConfigService,
        private readonly loadPending: LoadPendingIncomingCommand,
        private readonly loadGoods: LoadIncomingGoodsCommand,
        private readonly reprice: RepriceIncomingGoodsCommand,
        private readonly markHandled: MarkIncomingHandledCommand,
    ) {}

    chain(): CommandChainAsync<IncomingContext> {
        return new CommandChainAsync<IncomingContext>([
            this.loadPending,
            this.loadGoods,
            this.reprice,
            this.markHandled,
        ]);
    }

    // Боевое время задаёт cron.setup.ts; минута :07/:17/… — мимо пятиминуток и profitCheck (:04).
    @Cron('0 7/10 * * * *', { name: 'incomingGoods' })
    async run(): Promise<IncomingContext | null> {
        return this.process(Number(this.configService.get<number>('INCOMING_SETTLED_MINUTES', 15)));
    }

    /** Ручной запуск: берём всё, что в очереди, не дожидаясь тишины. */
    async manualCheck(): Promise<IncomingContext | null> {
        return this.process(0);
    }

    private async process(settledMinutes: number): Promise<IncomingContext | null> {
        if (this.running) return null;
        this.running = true;
        try {
            const ctx = await this.chain().execute({ settledMinutes, prihods: [], skus: [] });
            if (ctx.prihods.length) {
                this.logger.log(
                    `[incoming] приходов ${ctx.prihods.length} (${ctx.prihods.map((p) => p.np).join(', ')}), товаров ${ctx.skus.length}`,
                );
            }
            return ctx;
        } catch (e) {
            this.logger.error(`пересчёт цен по приходу не выполнен, заявки остались в очереди — ${e.message}`);
            return null;
        } finally {
            this.running = false;
        }
    }
}
