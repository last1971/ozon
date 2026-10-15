import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ReturnCardBuilder } from '../return-card.builder';
import { AcceptContext } from './return.contexts';

/** 1. Свежий снимок карточки внутри транзакции приёма — решения ниже принимаются по нему. */
@Injectable()
export class LoadReturnCardCommand implements ICommandAsync<AcceptContext> {
    constructor(private readonly builder: ReturnCardBuilder) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        return { ...ctx, card: await this.builder.build(ctx.line, ctx.t) };
    }
}
