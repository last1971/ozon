import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';
import { codesAfterOrders, distributeCodesToSkus, sumNominals } from '../mark-codes.distribution';

/**
 * Маркируемые товары с кодами: остаток на маркет — это свободные коды.
 *
 * Продать можно только то, на что есть код, поэтому учёт (`quantity − reserve`) в расчёт не
 * входит вовсе. Резерв закрывается ПО ЗАКАЗАМ: под каждый заказ подбирается свой код, как это
 * делает склад. Расхождение «кодов больше, чем на складе» только пишется в лог — это дыра в
 * данных, лечить её надо на складе, а не занижением остатка.
 */
@Injectable()
export class DistributeMarkedCountsCommand implements ICommandAsync<IGoodsCountContext> {
    private readonly logger = new Logger(DistributeMarkedCountsCommand.name);

    async execute(context: IGoodsCountContext): Promise<IGoodsCountContext> {
        const counts = new Map(context.counts);

        for (const good of context.goods) {
            const code = String(good.code);
            if (!context.markedGoods.has(code)) continue;

            const skus = context.filteredSkuMap.get(code) ?? [];
            if (skus.length === 0) continue;

            const free = context.freeByGood.get(code) ?? new Map<number, number>();
            const orders = context.reservedByGood.get(code) ?? [];
            const left = codesAfterOrders(free, orders);

            const codePieces = sumNominals(free);
            if (codePieces > good.quantity) {
                this.logger.warn(
                    `Товар ${code}: кодов на ${codePieces} шт, на складе ${good.quantity} — расхождение ${
                        codePieces - good.quantity
                    } шт`,
                );
            }

            distributeCodesToSkus(code, skus, left).forEach((quantity, sku) => counts.set(sku, quantity));
        }

        return { ...context, counts };
    }
}
