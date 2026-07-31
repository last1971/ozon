import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { IFbsSubmitContext } from '../interfaces/fbs-submit.context';
import { PostingService } from '../posting.service';
import { ExemplarProductDto } from '../dto/exemplar.create-or-get.dto';
import { ExemplarSetItemDto, ExemplarSetProductDto } from '../dto/exemplar.set.dto';

/**
 * Шаг 2: строим payload set по КАЖДОЙ строке (product_id), ветвясь на знак/без-знака.
 * - Строка СО ЗНАКОМ (есть привязанные КМ): ГТД по КМ (getGtdByKi → ctx.gtdByKi),
 *   марку шлём ТОЛЬКО если is_mandatory_mark_needed (иначе MANDATORY_MARK_REDUNDANT).
 * - Строка БЕЗ ЗНАКА (кодов нет): марку не шлём; ГТД из ФАКТИЧЕСКОГО подбора
 *   (getPickedPartiesGtdByScode), поштучно старые→новые, кол-во ГТД = кол-ву единиц.
 * ГТД шлём, если is_gtd_needed; отсутствие обязательной ГТД ловит validate (следующий шаг).
 */
@Injectable()
export class BuildExemplarsPayloadCommand implements ICommandAsync<IFbsSubmitContext> {
    constructor(
        @Inject(forwardRef(() => PostingService)) private readonly postingService: PostingService,
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
    ) {}

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
        const goodscodeByProduct = new Map<number, string>();
        for (const [gc, pid] of productMap) goodscodeByProduct.set(pid, gc);

        // Привязанные КМ (маркированные строки) по product_id.
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

        // ГТД немаркированных строк — из фактического подбора (лениво, один запрос).
        let pickedParties: { realpricecode: number; goodscode: string; quantity: number; gtd: string | null }[] | null =
            null;
        const getParties = async () =>
            (pickedParties ??= await this.invoiceService.getPickedPartiesGtdByScode(ctx.invoice.id, null));

        const setProducts: ExemplarSetProductDto[] = [];
        for (const exProduct of ctx.exResp.products as ExemplarProductDto[]) {
            const needMark = !!exProduct.is_mandatory_mark_needed;
            const needGtd = exProduct.is_gtd_needed !== false; // по умолчанию считаем нужной, если поле не пришло
            const group = attachedByProduct.get(exProduct.product_id) ?? [];

            if (group.length > 0) {
                // === СТРОКА СО ЗНАКОМ ===
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
                    .map((ex, i) => {
                        const gtd = needGtd ? ctx.gtdByKi.get(group[i].ki) ?? '' : '';
                        return {
                            exemplar_id: ex.exemplar_id,
                            marks: needMark
                                ? [{ mark: group[i].mark, mark_type: 'mandatory_mark' as const }]
                                : [],
                            gtd,
                            is_gtd_absent: !gtd,
                            is_rnpt_absent: true as const,
                        };
                    });
                setProducts.push({ product_id: exProduct.product_id, exemplars });
                continue;
            }

            // === СТРОКА БЕЗ ЗНАКА ===
            if (needMark) {
                // Озон требует марку, а кодов у нас нет — провал строки (кладовщик пропустил/недостача).
                ctx.failed.push({
                    ki: '*',
                    reason: `product_id ${exProduct.product_id}: Озон требует марку, а кодов нет`,
                });
                continue;
            }
            if (!needGtd) {
                // Ни марка, ни ГТД не нужны — пустые экземпляры.
                setProducts.push({
                    product_id: exProduct.product_id,
                    exemplars: exProduct.exemplars.map((ex) => ({
                        exemplar_id: ex.exemplar_id,
                        marks: [],
                        gtd: '',
                        is_gtd_absent: true,
                        is_rnpt_absent: true as const,
                    })),
                });
                continue;
            }
            // Нужна ГТД: берём поштучно из подбора (старые→новые).
            const gc = goodscodeByProduct.get(exProduct.product_id);
            const parties = (await getParties()).filter((p) => p.goodscode === gc);
            const gtdUnits: (string | null)[] = [];
            for (const p of parties) for (let k = 0; k < p.quantity; k++) gtdUnits.push(p.gtd);
            // Подбор в штуках склада (invoice QUAN = ozon_qty * коэффициент), exProduct.quantity — единицы Озона.
            // Нужно ГТД по экземпляру (единице Озона): достаточно, чтобы штук подбора хватило; берём поштучно.
            if (gtdUnits.length < exProduct.quantity) {
                ctx.failed.push({
                    ki: '*',
                    reason: `product_id ${exProduct.product_id}: подбор дал ${gtdUnits.length} ГТД-ед., нужно ${exProduct.quantity}`,
                });
                continue;
            }
            const exemplars: ExemplarSetItemDto[] = exProduct.exemplars.slice(0, exProduct.quantity).map((ex, i) => {
                const gtd = gtdUnits[i] ?? '';
                return {
                    exemplar_id: ex.exemplar_id,
                    marks: [],
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
