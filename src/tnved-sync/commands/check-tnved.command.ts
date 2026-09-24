import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';

/** Маркетплейс читает свои карточки и решает по каждой → ctx.items, ctx.notFound. Ничего не пишет. Фазы «каталог»/«сверка» ставит сам маркетплейс. */
@Injectable()
export class CheckTnvedCommand implements IJobCommand<ITnvedProcessingContext> {
    readonly phase = 'сверка';

    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const { items, notFound } = await context.service.checkTnved(context.base ?? [], context.progress);
        context.items = items;
        context.notFound = notFound;
        return context;
    }
}
