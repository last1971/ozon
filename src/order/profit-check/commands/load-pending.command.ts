import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { MpEventService, MpService } from '../../../mp-event/mp-event.service';
import { ProfitCheckContext, ProfitCheckItem, ProfitCheckPayload } from '../profit-check.types';
import { PROFIT_CHECK_KIND, PROFIT_CHECK_PENDING } from '../profit-check.constants';

/** 1. Необработанные записи «проверить прибыль» по площадкам, у которых есть источник цены. */
@Injectable()
export class LoadPendingCommand implements ICommandAsync<ProfitCheckContext> {
    constructor(private readonly journal: MpEventService) {}

    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        const items: ProfitCheckItem[] = [];
        for (const service of ['OZON', 'WB'] as MpService[]) {
            const rows = await this.journal.listUnhandledRows(service, PROFIT_CHECK_KIND, PROFIT_CHECK_PENDING);
            for (const r of rows) {
                const payload = r.payload as ProfitCheckPayload | null;
                if (!payload?.lines) continue;
                items.push({ posting: r.extId, firstSeen: r.firstSeen, payload, resolved: false, deferred: false });
            }
        }
        return { ...ctx, items, stopChain: items.length === 0 };
    }
}
