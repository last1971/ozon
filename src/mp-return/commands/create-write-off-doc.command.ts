import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { WriteOffContext } from './return.contexts';

/**
 * Документ списания штатной SPISANIE_UNIV1; партию для расхода процедура возьмёт по номеру в марках.
 * Строки с выданным номером нет — номер разъехался с документом: падаем, всё откатится.
 */
@Injectable()
export class CreateWriteOffDocCommand implements ICommandAsync<WriteOffContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: WriteOffContext): Promise<WriteOffContext> {
        await this.stock.spisanie(
            {
                goodscode: ctx.goodscode,
                username: ctx.username,
                quan: ctx.quan,
                prim: `Возврат ${ctx.posting}${ctx.comment ? `: ${ctx.comment}` : ''}`,
                osnSpisId: ctx.osnSpisId,
            },
            ctx.t,
        );
        if (!(await this.stock.spisDocExists(ctx.spisCode, ctx.t))) {
            throw new Error(`Документ списания с номером ${ctx.spisCode} не создан — номер разъехался с документом`);
        }
        return ctx;
    }
}
