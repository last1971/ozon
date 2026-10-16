import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { PeresortContext } from './peresort.context';

/**
 * 2. Маркируемому пересортица не положена: приход без кодов, а маркетплейсу товар уходит с кодами.
 * Экран кнопку такому не показывает; здесь — страховка от прямого вызова ручки.
 */
@Injectable()
export class AssertNotMarkedCommand implements ICommandAsync<PeresortContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: PeresortContext): Promise<PeresortContext> {
        if (await this.stock.isMarkRequired(ctx.line.goodscode, ctx.t)) {
            throw new BadRequestException(
                `${ctx.line.name ?? ctx.line.goodscode}: товар маркируемый — пересортицей недобор не закрыть`,
            );
        }
        return ctx;
    }
}
