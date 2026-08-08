import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';
import { distributeCodesToSkus, freeCodesAfterReserve } from '../mark-codes.distribution';

/**
 * Маркируемые товары с кодами: остаток на маркет — это свободные коды по номиналам.
 * Резерв закрывается целыми кодами, номинал уходит в свою фасовку, «бездомный» — штуками
 * в базовую. Кодов не осталось → все фасовки товара получают 0.
 */
@Injectable()
export class DistributeMarkedCountsCommand implements ICommandAsync<IGoodsCountContext> {
    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        const counts = new Map(context.counts);

        for (const good of context.goods) {
            const code = String(good.code);
            if (!context.markedGoods.has(code)) continue;

            const skus = context.filteredSkuMap.get(code) ?? [];
            if (skus.length === 0) continue;

            const free = context.freeByGood.get(code) ?? new Map<number, number>();
            const afterReserve = freeCodesAfterReserve(free, good.quantity, good.reserve);

            distributeCodesToSkus(code, skus, afterReserve).forEach((quantity, sku) => counts.set(sku, quantity));
        }

        return { ...context, counts };
    }
}
