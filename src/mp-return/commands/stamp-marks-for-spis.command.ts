import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { WriteOffContext } from './return.contexts';

/** Каждая марка проверяется и гасится списанием (6/2) с номером строки списания — до самого документа, как Delphi. */
@Injectable()
export class StampMarksForSpisCommand implements ICommandAsync<WriteOffContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: WriteOffContext): Promise<WriteOffContext> {
        for (const ki of ctx.kis) await this.stock.stampForSpis(ki, ctx.goodscode, ctx.spisCode, ctx.t);
        return ctx;
    }
}
