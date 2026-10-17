import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { MpEventService } from '../../mp-event/mp-event.service';
import { IncomingContext } from '../incoming.types';
import { INCOMING_KIND, INCOMING_PENDING, TRADE_SERVICE } from '../incoming.constants';

/** 4. Приходы прохода — обработаны. Новая строка в том же приходе снимет пометку (триггер), и он пройдёт снова. */
@Injectable()
export class MarkIncomingHandledCommand implements ICommandAsync<IncomingContext> {
    constructor(private readonly journal: MpEventService) {}

    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        for (const p of ctx.prihods) {
            await this.journal.markHandled({
                service: TRADE_SERVICE,
                kind: INCOMING_KIND,
                extId: p.np,
                state: INCOMING_PENDING,
            });
        }
        return ctx;
    }
}
