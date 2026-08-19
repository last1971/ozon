import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { IFbsSubmitContext } from '../interfaces/fbs-submit.context';
import { PostingService } from '../posting.service';
import { ExemplarProductDto } from '../dto/exemplar.create-or-get.dto';
import { ExemplarSetItemDto, ExemplarSetProductDto } from '../dto/exemplar.set.dto';
import { findPackLine } from '../pack-line.util';

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
        const packLines = await this.postingService.getPostingPackLines(ctx.postingNumber);
        if (packLines.length === 0) {
            ctx.stopChain = true;
            ctx.result = {
                ok: false,
                failed: [{ ki: '*', reason: 'posting/fbs/get не вернул products' }],
                skipRetry: true,
            };
            return ctx;
        }
        const packByProduct = new Map(packLines.map((l) => [l.productId, l]));

        // Привязанные КМ (маркированные строки) по product_id: позиция ищется по фасовке кода,
        // иначе мультипаки одного товара сольются и все коды уедут в одну позицию.
        const attachedByProduct = new Map<number, { ki: string; mark: string; quantity: number }[]>();
        for (const a of ctx.attached) {
            const mark = ctx.kmFullByKi.get(a.ki);
            if (!mark) continue;
            const line = findPackLine(packLines, a.goodscode, a.quantity);
            if (!line) {
                const known = packLines.some((l) => l.goodscode === a.goodscode);
                ctx.failed.push({
                    ki: a.ki,
                    reason: known
                        ? `goodscode ${a.goodscode}: фасовка кода ${a.quantity} не сопоставлена с позицией posting`
                        : `goodscode ${a.goodscode} не найден в posting`,
                });
                continue;
            }
            if (!attachedByProduct.has(line.productId)) attachedByProduct.set(line.productId, []);
            attachedByProduct.get(line.productId).push({ ki: a.ki, mark, quantity: a.quantity });
        }

        // ГТД немаркированных строк — из фактического подбора (лениво, один запрос).
        let pickedParties: { realpricecode: number; goodscode: string; quantity: number; gtd: string | null }[] | null =
            null;
        const getParties = async () =>
            (pickedParties ??= await this.invoiceService.getPickedPartiesGtdByScode(ctx.invoice.id, null));
        /** Съеденные штуки пула подбора по goodscode (мультипаки идут по одному пулу). */
        const gtdCursor = new Map<string, number>();

        const setProducts: ExemplarSetProductDto[] = [];
        for (const exProduct of ctx.exResp.products as ExemplarProductDto[]) {
            const needMark = !!exProduct.is_mandatory_mark_needed;
            const needGtd = exProduct.is_gtd_needed !== false; // по умолчанию считаем нужной, если поле не пришло
            const group = attachedByProduct.get(exProduct.product_id) ?? [];

            if (group.length > 0) {
                // === СТРОКА СО ЗНАКОМ ===
                // Один привязанный код = один экземпляр Ozon: штучный код (QUANTITY=1)
                // ИЛИ код-упаковка (QUANTITY=N) — Ozon принимает «один код с упаковки».
                // Сверяем ЧИСЛО КОДОВ с числом экземпляров, а НЕ сумму штук: у товара-упаковки
                // 1 юнит Ozon = N наших штук = 1 код (напр. арт. …-3: 2 юнита = 6 шт = 2 кода).
                if (group.length !== exProduct.quantity) {
                    ctx.failed.push({
                        ki: '*',
                        reason: `product_id ${exProduct.product_id}: привязано кодов ${group.length}, Ozon ждёт экземпляров ${exProduct.quantity}`,
                    });
                    continue;
                }
                const exemplars: ExemplarSetItemDto[] = exProduct.exemplars.slice(0, group.length).map((ex, i) => {
                    const gtd = needGtd ? (ctx.gtdByKi.get(group[i].ki) ?? '') : '';
                    return {
                        exemplar_id: ex.exemplar_id,
                        marks: needMark ? [{ mark: group[i].mark, mark_type: 'mandatory_mark' as const }] : [],
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
            const pack = packByProduct.get(exProduct.product_id);
            const gc = pack?.goodscode ?? '';
            const parties = (await getParties()).filter((p) => p.goodscode === gc);
            const gtdUnits: (string | null)[] = [];
            for (const p of parties) for (let k = 0; k < p.quantity; k++) gtdUnits.push(p.gtd);
            // Подбор в штуках склада (invoice QUAN = ozon_qty * коэффициент), exProduct.quantity — единицы Озона.
            // Мультипаки одного товара делят общий пул подбора: курсор двигаем на съеденные штуки,
            // иначе второй мультипак получит те же ГТД, что и первый.
            const pieces = pack?.pieces ?? 1;
            const need = exProduct.quantity * pieces;
            const from = gtdCursor.get(gc) ?? 0;
            const gtdSlice = gtdUnits.slice(from, from + need);
            if (gtdSlice.length < need) {
                ctx.failed.push({
                    ki: '*',
                    reason: `product_id ${exProduct.product_id}: подбор дал ${gtdSlice.length} ГТД-ед., нужно ${need}`,
                });
                continue;
            }
            gtdCursor.set(gc, from + need);
            const exemplars: ExemplarSetItemDto[] = exProduct.exemplars.slice(0, exProduct.quantity).map((ex, i) => {
                // ГТД первой штуки упаковки — экземпляр Озона равен pieces штукам склада.
                const gtd = gtdSlice[i * pieces] ?? '';
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
