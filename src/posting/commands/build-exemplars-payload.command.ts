import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IFbsSubmitContext } from '../interfaces/fbs-submit.context';
import { PostingService } from '../posting.service';
import { ExemplarItemDto, ExemplarProductDto } from '../dto/exemplar.create-or-get.dto';
import { ExemplarSetItemDto, ExemplarSetProductDto } from '../dto/exemplar.set.dto';

/**
 * Шаг 2: строим payload set из create-or-get + привязанных КМ (маркированные позиции).
 * Ветка «без знака» (getPickedPartiesGtdByScode) добавляется в 2c.
 */
@Injectable()
export class BuildExemplarsPayloadCommand implements ICommandAsync<IFbsSubmitContext> {
    constructor(@Inject(forwardRef(() => PostingService)) private readonly postingService: PostingService) {}

    async execute(ctx: IFbsSubmitContext): Promise<IFbsSubmitContext> {
        const productMap = await this.postingService.getPostingProductMap(ctx.postingNumber);
        if (productMap.size === 0) {
            ctx.stopChain = true;
            ctx.result = {
                ok: false,
                failed: [{ ki: '*', reason: 'posting/fbs/get не вернул products' }],
                skipRetry: true,
            };
            return ctx;
        }

        const attachedByProduct = new Map<number, { ki: string; mark: string; quantity: number }[]>();
        for (const a of ctx.attached) {
            const mark = ctx.kmFullByKi.get(a.ki);
            if (!mark) continue;
            const productId = productMap.get(a.goodscode);
            if (!productId) {
                ctx.failed.push({ ki: a.ki, reason: `goodscode ${a.goodscode} не найден в posting` });
                continue;
            }
            if (!attachedByProduct.has(productId)) attachedByProduct.set(productId, []);
            attachedByProduct.get(productId).push({ ki: a.ki, mark, quantity: a.quantity });
        }

        const setProducts: ExemplarSetProductDto[] = [];
        for (const exProduct of ctx.exResp.products as ExemplarProductDto[]) {
            const group = attachedByProduct.get(exProduct.product_id) ?? [];
            if (group.length === 0) continue;
            // экземпляры Ozon штучные: количественный КМ (QUANTITY>1) сюда не ложится
            const multi = group.find((g) => g.quantity > 1);
            if (multi) {
                ctx.failed.push({
                    ki: multi.ki,
                    reason:
                        `количественный КМ (x${multi.quantity}): Ozon FBS требует штучные экземпляры — ` +
                        'поделите код (MARKCODE_SPLIT / деление в ЛК ЧЗ)',
                });
                continue;
            }
            const qtySum = group.reduce((s, g) => s + g.quantity, 0);
            if (qtySum !== exProduct.quantity) {
                ctx.failed.push({
                    ki: '*',
                    reason: `product_id ${exProduct.product_id}: КМ на ${qtySum} шт, ожидается ${exProduct.quantity}`,
                });
                continue;
            }
            const exemplars: ExemplarSetItemDto[] = exProduct.exemplars
                .slice(0, group.length)
                .map((ex: ExemplarItemDto, i: number) => {
                    const gtd = ctx.gtdByKi.get(group[i].ki) ?? '';
                    return {
                        exemplar_id: ex.exemplar_id,
                        marks: [{ mark: group[i].mark, mark_type: 'mandatory_mark' as const }],
                        gtd,
                        is_gtd_absent: !gtd,
                        is_rnpt_absent: true as const,
                    };
                });
            setProducts.push({ product_id: exProduct.product_id, exemplars });
        }

        if (setProducts.length === 0) {
            ctx.stopChain = true;
            ctx.result = { ok: false, failed: ctx.failed };
            return ctx;
        }
        ctx.setProducts = setProducts;
        return ctx;
    }
}
