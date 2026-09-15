import { Injectable, Logger } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { IGoodsCountContext } from './i.goods.count.context';
import { codesAfterOrders, distributeCodesToSkus, dropCodesForNeed, sumNominals } from '../mark-codes.distribution';

/**
 * Маркируемые товары с кодами: остаток на маркет — это свободные коды.
 *
 * Продать можно только то, на что есть код, поэтому учёт (`quantity − reserve`) не задаёт
 * остаток. Резерв закрывается ПО ЗАКАЗАМ: под каждый заказ подбирается свой код, как это
 * делает склад.
 *
 * Но склад задаёт ВЕРХНЮЮ границу. Код без товара — не товар: 549853 уехал по FBS без скана
 * (счёт №18034 от 09.09.2026), код остался свободным, склад дошёл до нуля, и витрина месяц
 * показывала 1 шт, которую исправно заказывали. Излишек сверх склада отбрасываем тем же
 * солвером, что и резерв, и продолжаем писать про расхождение в лог — чинить его надо на
 * складе, здесь мы только не пускаем фантом на витрину.
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
            let left = codesAfterOrders(free, orders);

            const codePieces = sumNominals(free);
            if (codePieces > good.quantity) {
                this.logger.warn(
                    `Товар ${code}: кодов на ${codePieces} шт, на складе ${good.quantity} — расхождение ${
                        codePieces - good.quantity
                    } шт`,
                );
            }

            // Верхняя граница — физически доступное. Резерв уже снят по заказам выше,
            // поэтому сравниваем с `quantity − reserve`.
            const available = Math.max(good.quantity - (good.reserve ?? 0), 0);
            const leftPieces = sumNominals(left);
            if (leftPieces > available) {
                left = dropCodesForNeed(left, leftPieces - available);
                this.logger.warn(
                    `Товар ${code}: кодов свободно на ${leftPieces} шт, доступно на складе ${available} —` +
                        ` на витрину отдаём ${sumNominals(left)} шт`,
                );
            }

            distributeCodesToSkus(code, skus, left).forEach((quantity, sku) => counts.set(sku, quantity));
        }

        return { ...context, counts };
    }
}
