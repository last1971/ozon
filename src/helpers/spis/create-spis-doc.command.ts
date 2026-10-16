import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { ISpisContext } from './spis.context';

/**
 * Документ списания штатной SPISANIE_UNIV1 по `spis` из контекста; партию для расхода процедура
 * возьмёт сама. Строки с выданным номером нет — номер разъехался с документом: падаем, всё откатится.
 */
@Injectable()
export class CreateSpisDocCommand implements ICommandAsync<ISpisContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    /** Generic на методе: один экземпляр обслуживает цепочки с разными контекстами. */
    async execute<T extends ISpisContext>(ctx: T): Promise<T> {
        if (!ctx.spis || !ctx.spisCode) throw new Error('Документ списания не подготовлен: нет spis или spisCode');
        await this.stock.spisanie(ctx.spis, ctx.t);
        if (!(await this.stock.spisDocExists(ctx.spisCode, ctx.t))) {
            throw new Error(`Документ списания с номером ${ctx.spisCode} не создан — номер разъехался с документом`);
        }
        return ctx;
    }
}
