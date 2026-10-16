import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { ISpisContext } from './spis.context';

/**
 * Номер строки списания — заранее, генератором стороны инсталляции, и в контекст транзакции ВСЕГДА
 * (и без марок): иначе триггер выдаст строке свой номер, и в журнал ляжет номер несуществующего документа.
 */
@Injectable()
export class AllocateSpisCodeCommand implements ICommandAsync<ISpisContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    /** Generic на методе: один экземпляр обслуживает цепочки с разными контекстами. */
    async execute<T extends ISpisContext>(ctx: T): Promise<T> {
        const spisCode = await this.stock.allocateSpisCode(ctx.t);
        await this.stock.setSpisContext(spisCode, ctx.t);
        return { ...ctx, spisCode };
    }
}
