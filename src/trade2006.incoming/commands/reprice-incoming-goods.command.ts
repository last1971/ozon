import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ExtraPriceService } from '../../price/extra.price.service';
import { IncomingContext } from '../incoming.types';

/**
 * 3. Композиция: цепочка прихода из цен (ExtraPriceService.incomingGoodsChain) по кодам прохода.
 * Ошибка цепочки летит наверх — приход остаётся в очереди и пойдёт следующим проходом.
 * Приход без товаров (все строки удалили) — считать нечего, но пометить обработанным надо.
 */
@Injectable()
export class RepriceIncomingGoodsCommand implements ICommandAsync<IncomingContext> {
    constructor(private readonly prices: ExtraPriceService) {}

    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        if (ctx.skus.length === 0) return ctx;
        await this.prices.incomingGoodsChain().execute({ skus: ctx.skus, logger: this.prices.chainLogger() });
        return ctx;
    }
}
