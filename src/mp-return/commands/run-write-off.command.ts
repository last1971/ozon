import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ReturnRefusedError } from '../return-refused.error';
import { AcceptContext, WriteOffContext, writeOffSpis } from './return.contexts';

/**
 * Стык цепочек «Вернуть и списать»: из контекста приёма строит контекст списания и запускает цепочку
 * списания в той же транзакции. Не @Injectable — собирается фабрикой, которой одной известен состав цепочек.
 */
export class RunWriteOffCommand implements ICommandAsync<AcceptContext> {
    constructor(private readonly writeOffChain: ICommandAsync<WriteOffContext>) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        if (!ctx.osnSpisId) throw new ReturnRefusedError('Не выбрано основание списания');
        const doc = {
            goodscode: ctx.card.invoiceLine.goodscode,
            quan: ctx.card.quan,
            username: ctx.username,
            osnSpisId: ctx.osnSpisId,
            comment: ctx.comment,
            posting: ctx.line.posting,
        };
        const writeOff = await this.writeOffChain.execute({
            t: ctx.t,
            service: ctx.line.service,
            extId: ctx.line.extId,
            kis: ctx.kis,
            ...doc,
            spis: writeOffSpis(doc),
        });
        return { ...ctx, writeOff };
    }
}
