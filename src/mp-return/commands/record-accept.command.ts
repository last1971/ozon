import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { MpReturnAcceptStore } from '../../mp-event/mp-return-accept.store';
import { AcceptContext } from './return.contexts';

/** 9. Запись в журнал приёма — точка правды «обработан». Повтор упадёт на уникальности и откатит всё. */
@Injectable()
export class RecordAcceptCommand implements ICommandAsync<AcceptContext> {
    constructor(private readonly store: MpReturnAcceptStore) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const { card, line } = ctx;
        const acceptId = await this.store.insert(
            {
                service: line.service,
                extId: line.extId,
                posting: line.posting,
                scode: card.invoice?.scode ?? null,
                realpricecode: card.invoiceLine?.realpricecode ?? null,
                goodscode: card.invoiceLine?.goodscode ?? null,
                units: line.units,
                pieces: card.pieces,
                quan: card.quan,
                decision: ctx.action === 'problem' ? 'PROBLEM' : 'RETURN',
                kis: ctx.kis,
                retiredKis: ctx.retiredKis,
                comment: ctx.comment,
                username: ctx.username,
            },
            ctx.t,
        );
        return { ...ctx, acceptId };
    }
}
