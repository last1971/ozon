import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { PeresortContext } from './peresort.context';

/**
 * 1. Строка счёта свежим снимком внутри транзакции: недобор = нужно − подобрано, и он должен быть
 * кратен фасовке строки — маркетплейсу уходят целые юниты. Нет недобора — делать нечего.
 */
@Injectable()
export class LoadShortageLineCommand implements ICommandAsync<PeresortContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: PeresortContext): Promise<PeresortContext> {
        const line = (await this.stock.getLines(ctx.scode, ctx.t)).find((l) => l.realpricecode === ctx.realpricecode);
        if (!line) throw new NotFoundException(`строка ${ctx.realpricecode} в счёте SCODE ${ctx.scode} не найдена`);

        const quantity = line.quantity - line.picked;
        if (quantity <= 0)
            throw new BadRequestException(
                `${line.name ?? line.goodscode}: недобора нет — подобрано ${line.picked} из ${line.quantity}`,
            );
        if (line.pieces && quantity % line.pieces !== 0) {
            throw new BadRequestException(
                `${line.name ?? line.goodscode}: недобор ${quantity} не кратен фасовке ${line.pieces} — разберите руками`,
            );
        }
        return { ...ctx, line, quantity };
    }
}
