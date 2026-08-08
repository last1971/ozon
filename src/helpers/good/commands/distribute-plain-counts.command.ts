import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';
import { distributeGoodQuantities } from '../plain.distribution';

/**
 * Немаркируемые товары (и маркируемые без единого кода) — прежняя схема:
 * `quantity − reserve` пропорционально коэффициентам фасовок.
 */
@Injectable()
export class DistributePlainCountsCommand implements ICommandAsync<IGoodsCountContext> {
    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        const counts = new Map(context.counts);

        for (const good of context.goods) {
            const code = String(good.code);
            if (context.markedGoods.has(code)) continue;

            const skus = context.filteredSkuMap.get(code) ?? [];
            if (skus.length === 0) continue;

            distributeGoodQuantities(skus, good).forEach((quantity, sku) => counts.set(sku, quantity));
        }

        return { ...context, counts };
    }
}
