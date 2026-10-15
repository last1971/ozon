import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ReturnRefusedError } from '../return-refused.error';
import { AcceptContext } from './return.contexts';

/** 3. Принять можно: причины отказа считает та же оценка, что показывает экран. */
@Injectable()
export class AssertAcceptableCommand implements ICommandAsync<AcceptContext> {
    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        if (ctx.card.blockers.length) throw new ReturnRefusedError(ctx.card.blockers.join('; '));
        return ctx;
    }
}
