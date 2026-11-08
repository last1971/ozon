import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { MpEventService } from '../../../mp-event/mp-event.service';
import { ProfitCheckContext } from '../profit-check.types';
import { PROFIT_CHECK_KIND, PROFIT_CHECK_PENDING } from '../profit-check.constants';

/** 6. Проверенные и «не проверено» — обработаны. Отложенные (ждём цену или данные) остаются в очереди. */
@Injectable()
export class MarkHandledCommand implements ICommandAsync<ProfitCheckContext> {
    constructor(private readonly journal: MpEventService) {}

    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        for (const item of ctx.items) {
            if (item.deferred) {
                if (item.retryReason || item.completedLineKeys?.length) {
                    const original = item.originalPayload ?? item.payload;
                    const payload = {
                        ...original,
                        check: {
                            completedLineKeys: item.completedLineKeys ?? original.check?.completedLineKeys ?? [],
                            retryReason: item.retryReason,
                        },
                    };
                    if (JSON.stringify(original.check) !== JSON.stringify(payload.check))
                        await this.journal.updatePendingPayload(
                            {
                                service: item.payload.service,
                                kind: PROFIT_CHECK_KIND,
                                extId: item.posting,
                                state: PROFIT_CHECK_PENDING,
                            },
                            payload,
                        );
                }
                continue;
            }
            await this.journal.markHandled(
                {
                    service: item.payload.service,
                    kind: PROFIT_CHECK_KIND,
                    extId: item.posting,
                    state: PROFIT_CHECK_PENDING,
                },
                ctx.t,
            );
        }
        return ctx;
    }
}
