import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { DonorPiecesStore } from '../donor-pieces.store';
import { DonorPiecesContext, DonorPiecesResult } from '../donor-pieces.types';

/**
 * 4. Записать фасовку в транзакции `t`. Строку, которую база не приняла (триггер: подобрано
 * больше, чем в строке), переводим в спор с текстом базы — остальное пишется, и в журнале
 * эта строка будет спорной, а не «готово».
 */
@Injectable()
export class WritePiecesCommand implements ICommandAsync<DonorPiecesContext> {
    private readonly logger = new Logger(WritePiecesCommand.name);

    constructor(private readonly store: DonorPiecesStore) {}

    async execute(ctx: DonorPiecesContext): Promise<DonorPiecesContext> {
        const results: DonorPiecesResult[] = [];
        for (const result of ctx.results ?? []) {
            if (!result.fills.length) {
                results.push({ ...result, written: 0 });
                continue;
            }
            const disputes = [...result.disputes];
            let written = 0;
            for (const fill of result.fills) {
                try {
                    await this.store.setPieces(fill.realpricecode, fill.pieces, ctx.t);
                    written++;
                } catch (e) {
                    this.logger.warn(`счёт №${result.invoice.invoiceNumber} строка ${fill.realpricecode}: ${e.message}`);
                    disputes.push({ realpricecode: fill.realpricecode, goodscode: fill.goodscode, reason: `база не приняла фасовку: ${e.message}` });
                }
            }
            results.push({ ...result, disputes, written, outcome: disputes.length ? 'DISPUTE' : result.outcome });
        }
        return { ...ctx, results };
    }
}
