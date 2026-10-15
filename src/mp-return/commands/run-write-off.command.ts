import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ReturnRefusedError } from '../return-refused.error';
import { AcceptContext, WriteOffContext } from './return.contexts';

/**
 * Стык цепочек «Вернуть и списать»: из контекста приёма строит контекст списания и запускает цепочку
 * списания в той же транзакции. Не @Injectable — собирается фабрикой, которой одной известен состав цепочек.
 */
export class RunWriteOffCommand implements ICommandAsync<AcceptContext> {
    constructor(private readonly writeOffChain: ICommandAsync<WriteOffContext>) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        if (!ctx.osnSpisId) throw new ReturnRefusedError('Не выбрано основание списания');
        const writeOff = await this.writeOffChain.execute({
            t: ctx.t,
            service: ctx.line.service,
            extId: ctx.line.extId,
            posting: ctx.line.posting,
            goodscode: ctx.card.invoiceLine.goodscode,
            quan: ctx.card.quan,
            kis: ctx.kis,
            username: ctx.username,
            osnSpisId: ctx.osnSpisId,
            comment: ctx.comment,
        });
        return { ...ctx, writeOff };
    }
}
