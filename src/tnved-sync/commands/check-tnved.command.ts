import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ITnvedProcessingContext } from '../../interfaces/i.tnved.processing.context';

/** Маркетплейс читает свои карточки и решает по каждой → ctx.items, ctx.notFound. Ничего не пишет. */
@Injectable()
export class CheckTnvedCommand implements ICommandAsync<ITnvedProcessingContext> {
    async execute(context: ITnvedProcessingContext): Promise<ITnvedProcessingContext> {
        const { items, notFound } = await context.service.checkTnved(context.base ?? []);
        context.items = items;
        context.notFound = notFound;
        return context;
    }
}
