import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';

/**
 * Крон-путь: маркет отдал свои текущие остатки — шлём назад только то, что изменилось.
 * SKU, которого нет в нашем расчёте, обнуляется (так было и в прежнем коде).
 * Событийный путь (currentCounts нет) проходит насквозь.
 */
@Injectable()
export class KeepChangedOnlyCommand implements ICommandAsync<IGoodsCountContext> {
    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        if (!context.currentCounts) return context;

        const counts = new Map<string, number>();
        for (const [sku, currentCount] of context.currentCounts) {
            const newCount = context.counts.get(sku) || 0;
            if (currentCount !== newCount) counts.set(sku, newCount);
        }

        return { ...context, counts };
    }
}
