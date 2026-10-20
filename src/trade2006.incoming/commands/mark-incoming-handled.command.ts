import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { MpEventService } from '../../mp-event/mp-event.service';
import { NotifyTopic } from '../../notify/notify.types';
import { IncomingContext } from '../incoming.types';
import { INCOMING_KIND, INCOMING_PENDING, TRADE_SERVICE } from '../incoming.constants';

/**
 * 4. Приходы прохода — обработаны. Новая строка в том же приходе снимет пометку (триггер), и он пройдёт снова.
 * Приход, в котором есть товар без остатка на складе (heldSkus), остаётся в очереди — цену ему посчитать было
 * не из чего, следующий проход (10 мин) попробует снова. Держим не дольше INCOMING_HOLD_HOURS (по умолчанию 2 ч)
 * от первого появления: товар так и не дошёл до склада — закрываем и пишем в тему «цены», а не крутим вечно.
 */
@Injectable()
export class MarkIncomingHandledCommand implements ICommandAsync<IncomingContext> {
    private readonly logger = new Logger(MarkIncomingHandledCommand.name);

    constructor(
        private readonly journal: MpEventService,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        const held = new Set(ctx.heldSkus || []);
        const configured = Number(this.configService.get('INCOMING_HOLD_HOURS', 2));
        const holdMs = (Number.isFinite(configured) ? configured : 2) * 3600 * 1000;
        const expired: string[] = [];
        for (const p of ctx.prihods) {
            const waiting = (ctx.goodsByPrihod?.get(String(p.np).trim()) || []).filter((code) => held.has(code));
            if (waiting.length > 0) {
                const age = Date.now() - new Date(p.firstSeen).getTime();
                if (age < holdMs) {
                    this.logger.warn(
                        `[incoming] приход ${p.np} оставлен в очереди: нет на складе ${waiting.join(', ')} — цену не из чего считать`,
                    );
                    continue;
                }
                expired.push(`приход ${p.np}: ${waiting.join(', ')}`);
            }
            await this.journal.markHandled({
                service: TRADE_SERVICE,
                kind: INCOMING_KIND,
                extId: p.np,
                state: INCOMING_PENDING,
            });
        }
        if (expired.length > 0) {
            const text = `Товара так и нет на складе, цену не пересчитали, приход закрыт:\n${expired.join('\n')}`;
            this.logger.warn(`[incoming] ${text}`);
            this.eventEmitter.emit('error.message', 'Приход: цена не пересчитана', text, NotifyTopic.PRICES);
        }
        return ctx;
    }
}
