import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { FboShortageCloser } from '../fbo-shortage-closer';
import { PeresortContext } from './peresort.context';

/** 5. Закрыть недобор в журнале и отдать счёт в подбор — той же точкой, что перенос с доноров. */
@Injectable()
export class CloseShortageCommand implements ICommandAsync<PeresortContext> {
    constructor(private readonly closer: FboShortageCloser) {}

    async execute(ctx: PeresortContext): Promise<PeresortContext> {
        const result = await this.closer.close(
            ctx.posting,
            ctx.scode,
            new Map([[ctx.line.goodscode, ctx.quantity]]),
            ctx.t,
        );
        return { ...ctx, ...result };
    }
}
