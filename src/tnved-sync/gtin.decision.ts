import { SyncCheckResult } from '../interfaces/i.card.sync';
import { BarcodeOffer, GtinBaseItem, GtinCheckItem } from '../interfaces/i.gtin.sync';
import { barcodeKey, minPackOffer } from '../helpers/product/product.helpers';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';

/**
 * Решение режима GTIN, общее для всех площадок: площадка отдаёт свои карточки товара с баркодами,
 * здесь — какая карточка целевая и чего на ней не хватает. Площадка потом только пишет.
 *
 * Целевая карточка — минимальная фасовка товара (без суффикса = 1). Остальные фасовки не трогаем.
 * GTIN сравниваются без ведущих нулей (14/13/12 знаков — один код). Баркод площадки уникален в кабинете,
 * поэтому GTIN, который уже висит на другой фасовке этого товара, на целевую не повесить — «спорно», руками.
 */
export function checkGtinOffers(
    base: GtinBaseItem[],
    offersByGood: Map<string, BarcodeOffer[]>,
    progress: JobProgress = emptyProgress(),
): SyncCheckResult<GtinCheckItem> {
    Object.assign(progress, { phase: 'сверка', done: 0, total: base.length });
    const result: SyncCheckResult<GtinCheckItem> = { items: [], notFound: [] };

    for (const row of base) {
        const offers = offersByGood.get(row.goodscode) ?? [];
        const targetOffer = minPackOffer(offers.map((o) => o.offer));
        const target = offers.find((o) => o.offer === targetOffer);
        progress.done++;
        if (!target) {
            result.notFound.push(row.goodscode);
            continue;
        }

        const present = new Set(target.barcodes.map(barcodeKey));
        const item: GtinCheckItem = {
            offer: target.offer,
            goodscode: row.goodscode,
            name: target.name,
            current: target.barcodes.length ? target.barcodes.join(', ') : null,
            base: row.gtins.join(', '),
            ok: false,
            add: row.gtins.filter((g) => !present.has(barcodeKey(g))),
            marketId: target.marketId,
        };

        if (!item.add.length) {
            result.items.push({ ...item, ok: true });
            continue;
        }
        if (target.ambiguousReason) {
            result.items.push({ ...item, ambiguousReason: target.ambiguousReason });
            continue;
        }
        const busy = item.add
            .map((g) => ({
                g,
                on: offers.find((o) => o !== target && o.barcodes.some((b) => barcodeKey(b) === barcodeKey(g))),
            }))
            .filter((x) => x.on);
        if (busy.length) {
            const where = busy.map((x) => `${x.g} уже на ${x.on.offer}`).join('; ');
            result.items.push({
                ...item,
                ambiguousReason: `${where} — баркод не повесить на ${target.offer}, сначала снять там`,
            });
            continue;
        }
        result.items.push({
            ...item,
            reason: `нет в баркодах: ${item.add.join(', ')}`,
            action: `добавить ${item.add.join(', ')}`,
        });
    }
    return result;
}
