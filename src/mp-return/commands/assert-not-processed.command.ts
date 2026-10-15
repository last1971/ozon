import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ReturnRefusedError } from '../return-refused.error';
import { AcceptContext } from './return.contexts';

/** 2. Строка возврата ещё не обработана (ни приёмом, ни «проблемой»). */
@Injectable()
export class AssertNotProcessedCommand implements ICommandAsync<AcceptContext> {
    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const accepted = ctx.card.accepted;
        if (accepted) {
            const what = accepted.decision === 'PROBLEM' ? 'отмечен проблемой' : 'уже принят';
            throw new ReturnRefusedError(
                `Возврат ${what} (${accepted.username ?? '—'}, ${accepted.createdAt.slice(0, 10)})`,
            );
        }
        return ctx;
    }
}
