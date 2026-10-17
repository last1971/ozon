import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { MpEventService } from '../../mp-event/mp-event.service';
import { IncomingContext } from '../incoming.types';
import { INCOMING_KIND, INCOMING_PENDING, TRADE_SERVICE } from '../incoming.constants';

/** 1. Приходы из очереди, которые перестали набивать settledMinutes минут назад. */
@Injectable()
export class LoadPendingIncomingCommand implements ICommandAsync<IncomingContext> {
    constructor(private readonly journal: MpEventService) {}

    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        const rows = await this.journal.listSettledUnhandled(
            TRADE_SERVICE,
            INCOMING_KIND,
            INCOMING_PENDING,
            ctx.settledMinutes,
        );
        const prihods = rows.map((r) => ({ np: r.extId, firstSeen: r.firstSeen }));
        return { ...ctx, prihods, stopChain: prihods.length === 0 };
    }
}
