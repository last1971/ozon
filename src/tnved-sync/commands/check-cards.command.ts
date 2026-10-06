import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ICardSyncContext } from '../../interfaces/i.card.sync';

/** Маркетплейс читает свои карточки и решает по каждой → ctx.items, ctx.notFound. Ничего не пишет. Фазы «каталог»/«сверка» ставит сам маркетплейс. */
@Injectable()
export class CheckCardsCommand implements IJobCommand<ICardSyncContext<any, any>> {
    readonly phase = 'сверка';

    async execute(context: ICardSyncContext<any, any>): Promise<ICardSyncContext<any, any>> {
        const { items, notFound, forFile } = await context.service.check(context.base ?? [], context.progress);
        context.items = items;
        context.notFound = notFound;
        context.forFile = forFile ?? [];
        return context;
    }
}
