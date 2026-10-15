import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { WriteOffContext } from './return.contexts';

/**
 * Номер строки списания — заранее, генератором стороны инсталляции, и в контекст транзакции ВСЕГДА
 * (и без марок): иначе триггер выдаст строке свой номер, и в журнал ляжет номер несуществующего документа.
 */
@Injectable()
export class AllocateSpisCodeCommand implements ICommandAsync<WriteOffContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: WriteOffContext): Promise<WriteOffContext> {
        const spisCode = await this.stock.allocateSpisCode(ctx.t);
        await this.stock.setSpisContext(spisCode, ctx.t);
        return { ...ctx, spisCode };
    }
}
