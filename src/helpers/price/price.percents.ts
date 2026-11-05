import type { IGood } from '../../interfaces/IGood';
import type { PricesContextDto } from '../dto/prices.context.dto';
import { goodCode, goodQuantityCoeff } from '../index';

/** Единый подбор отсутствующих наценок для пересчёта и экрана; без записи в БД. */
export async function completePricePercents(
    skus: string[],
    goodsService: IGood,
    known: PricesContextDto,
): Promise<void> {
    const { percents } = known;
    const missing = skus.filter(
        (sku) =>
            !percents.some(
                (p) =>
                    String(p.offer_id) === goodCode({ offer_id: sku }) &&
                    p.pieces === goodQuantityCoeff({ offer_id: sku }) &&
                    !(p.return_perc_at != null && p.min_perc == null && p.perc == null && p.old_perc == null),
            ),
    );
    if (!missing.length) return;
    const generated = await goodsService.generatePercentsForService(null, missing, undefined, known);
    for (const row of generated) {
        const existing = percents.find((p) => String(p.offer_id) === String(row.offer_id) && p.pieces === row.pieces);
        if (existing) Object.assign(existing, row);
        else percents.push(row);
    }
}
