import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { PERESORT_OSN_SPIS_ID, PeresortContext } from './peresort.context';

/**
 * 3. Приход пересортицей: штатная SPISANIE_UNIV1 с МИНУСОМ и основанием «пересортица» — ровно так,
 * как оформляют руками в Trade. Номер документа выдаём заранее генератором стороны инсталляции и
 * кладём в контекст транзакции, иначе триггер выдаст свой, и в ответ уйдёт номер не того документа.
 */
@Injectable()
export class CreatePeresortDocCommand implements ICommandAsync<PeresortContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: PeresortContext): Promise<PeresortContext> {
        const spisCode = await this.stock.allocateSpisCode(ctx.t);
        await this.stock.setSpisContext(spisCode, ctx.t);
        await this.stock.spisanie(
            {
                goodscode: ctx.line.goodscode,
                username: ctx.username,
                quan: -ctx.quantity,
                prim: `пересортица, недобор FBO, счёт ${ctx.scode} (${ctx.posting})`,
                osnSpisId: PERESORT_OSN_SPIS_ID,
            },
            ctx.t,
        );
        if (!(await this.stock.spisDocExists(spisCode, ctx.t))) {
            throw new Error(`Документ пересортицы с номером ${spisCode} не создан — номер разъехался с документом`);
        }
        return { ...ctx, spisCode };
    }
}
