import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { MpEventService } from '../../../mp-event/mp-event.service';
import { journalSafe, journalState } from '../donor-pieces.matcher';
import { DonorPiecesContext, DonorPiecesResult } from '../donor-pieces.types';

/**
 * 5. Итог по каждой поставке — в журнал MP_EVENT (вид DONOR_PIECES, ключ — номер поставки,
 * состояние — итог с отпечатком спора). Журнал сам отвечает, видели ли такой итог: это и есть
 * защита от одинакового письма каждый вечер. Ошибку Озона не пишем — следующий проход спросит заново.
 */
@Injectable()
export class JournalOutcomesCommand implements ICommandAsync<DonorPiecesContext> {
    constructor(private readonly journal: MpEventService) {}

    async execute(ctx: DonorPiecesContext): Promise<DonorPiecesContext> {
        const results: DonorPiecesResult[] = [];
        for (const result of ctx.results ?? []) {
            if (result.outcome === 'OZON_ERROR') {
                results.push(result);
                continue;
            }
            const { invoice } = result;
            const isNew = await this.journal.record(
                {
                    service: 'OZON',
                    kind: 'DONOR_PIECES',
                    extId: invoice.supplyNumber ?? `S${invoice.scode}`,
                    state: journalState(result),
                    posting: String(invoice.invoiceNumber),
                    payload: {
                        scode: invoice.scode,
                        prim: journalSafe(invoice.prim),
                        disputes: result.disputes.map((d) => ({ ...d, reason: journalSafe(d.reason) })),
                    },
                },
                ctx.t,
            );
            results.push({ ...result, isNew });
        }
        return { ...ctx, results };
    }
}
