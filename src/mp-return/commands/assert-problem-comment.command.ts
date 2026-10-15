import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ReturnRefusedError } from '../return-refused.error';
import { AcceptContext } from './return.contexts';

/** «Проблема» без комментария — бесполезна для спора с маркетплейсом. */
@Injectable()
export class AssertProblemCommentCommand implements ICommandAsync<AcceptContext> {
    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        if (!ctx.comment?.trim()) throw new ReturnRefusedError('Опишите проблему: что не так с посылкой');
        return ctx;
    }
}
