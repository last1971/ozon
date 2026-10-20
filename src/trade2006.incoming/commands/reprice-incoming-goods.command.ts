import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { ExtraPriceService } from '../../price/extra.price.service';
import { goodCode } from '../../helpers';
import { IncomingContext } from '../incoming.types';

/**
 * 3. Композиция: цепочка прихода из цен (ExtraPriceService.incomingGoodsChain) по кодам прохода.
 * Ошибка цепочки летит наверх — приход остаётся в очереди и пойдёт следующим проходом.
 * Приход без товаров (все строки удалили) — считать нечего, но пометить обработанным надо.
 * Товары, которых площадки не посчитали, потому что их нет на складе (`not-in-stock`), — в heldSkus:
 * их приходы подождут следующего прохода. «Нет свободного остатка» не держит: продавать нечего, ждать бесполезно.
 */
@Injectable()
export class RepriceIncomingGoodsCommand implements ICommandAsync<IncomingContext> {
    constructor(private readonly prices: ExtraPriceService) {}

    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        if (ctx.skus.length === 0) return ctx;
        const result = await this.prices
            .incomingGoodsChain()
            .execute({ skus: ctx.skus, logger: this.prices.chainLogger() });
        const heldSkus = [
            ...new Set(
                (result?.priceReports || [])
                    .flatMap((r) => r.skipped)
                    .filter((s) => s.reason === 'not-in-stock')
                    .map((s) => goodCode({ offer_id: s.offer_id })),
            ),
        ];
        return { ...ctx, heldSkus };
    }
}
