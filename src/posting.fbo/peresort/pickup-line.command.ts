import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { PeresortContext } from './peresort.context';

/**
 * 4. Подобрать недостающее в строку счёта штатной UPDATE_PODB: «подобрано» +недобор, «нужно» —
 * до количества строки, если подборка его ещё не знает. Строки подборки может не быть
 * (подобрано 0) — тогда сперва пустая, чтобы сработали триггеры UPDATE (расход партии, автостатус).
 */
@Injectable()
export class PickupLineCommand implements ICommandAsync<PeresortContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: PeresortContext): Promise<PeresortContext> {
        const { line, quantity } = ctx;
        if (!line.podbposcode) {
            await this.stock.ensurePodbLine(
                { scode: ctx.scode, goodscode: line.goodscode, realpricecode: line.realpricecode },
                ctx.t,
            );
        }
        await this.stock.updatePodb(
            {
                goodscode: line.goodscode,
                deltaQuan: quantity,
                deltaNeed: Math.max(0, line.quantity - line.need),
                realpricecode: line.realpricecode,
                scode: ctx.scode,
                username: ctx.username,
            },
            ctx.t,
        );
        return ctx;
    }
}
