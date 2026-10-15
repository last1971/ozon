import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { AcceptContext } from './return.contexts';

/**
 * 7. Расформировать вернувшиеся штуки: «подобрано» −quan, «нужно» −min(quan, нужно) одной штатной UPDATE_PODB.
 * Товар возвращается на склад и в партию кода; «ниже отгруженного по УПД» не пустит триггер PODBPOS_AU2.
 */
@Injectable()
export class DisbandPodbCommand implements ICommandAsync<AcceptContext> {
    constructor(@Inject(RETURN_STOCK) private readonly stock: IReturnStock) {}

    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const { invoiceLine, invoice, quan } = ctx.card;
        await this.stock.updatePodb(
            {
                goodscode: invoiceLine.goodscode,
                deltaQuan: -quan,
                deltaNeed: -Math.min(quan, invoiceLine.need),
                realpricecode: invoiceLine.realpricecode,
                scode: invoice.scode,
                username: ctx.username,
            },
            ctx.t,
        );
        return ctx;
    }
}
