import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { PERESORT_OSN_SPIS_ID, PeresortContext } from './peresort.context';

/**
 * 3. Документ пересортицы: SPISANIE_UNIV1 с МИНУСОМ на весь недобор и основанием «пересортица» —
 * ровно так, как оформляют руками в Trade. Сам документ делают общие шаги (номер, запись).
 */
@Injectable()
export class BuildPeresortDocCommand implements ICommandAsync<PeresortContext> {
    async execute(ctx: PeresortContext): Promise<PeresortContext> {
        return {
            ...ctx,
            spis: {
                goodscode: ctx.line.goodscode,
                username: ctx.username,
                quan: -ctx.quantity,
                prim: `пересортица, недобор FBO, счёт ${ctx.scode} (${ctx.posting})`,
                osnSpisId: PERESORT_OSN_SPIS_ID,
            },
        };
    }
}
