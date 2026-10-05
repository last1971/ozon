import { SyncCheckResult } from '../interfaces/i.card.sync';
import { BarcodeOffer, GtinBaseItem, GtinCheckItem } from '../interfaces/i.gtin.sync';
import { barcodeKey, minPackOffer } from '../helpers/product/product.helpers';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';

/**
 * Решение режима GTIN, общее для всех площадок: площадка отдаёт свои карточки товара с баркодами,
 * здесь — какая карточка что получает. Площадка потом только пишет.
 *
 * Держатель — карточка, в чьих баркодах уже стоит GTIN товара, иначе минимальная фасовка (без суффикса = 1).
 * Держателю — все GTIN базы в баркоды. GTIN сравниваются без ведущих нулей (14/13/12 знаков — один код).
 * Баркод уникален в кабинете, поэтому GTIN, разъехавшиеся по двум карточкам товара, — «спорно», руками.
 * Остальным карточкам товара — один GTIN (тот, что держит держатель) в поле «дополнительный GTIN», если
 * площадка его даёт (extraSlot); без такого поля они не трогаются.
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
        progress.done++;
        if (!offers.length) {
            result.notFound.push(row.goodscode);
            continue;
        }
        const keys = new Set(row.gtins.map(barcodeKey));
        const holds = (o: BarcodeOffer) => o.barcodes.some((b) => keys.has(barcodeKey(b)));
        const holders = offers.filter(holds);
        const holder = holders[0] ?? offers.find((o) => o.offer === minPackOffer(offers.map((o) => o.offer)));
        const holderItem = holderDecision(row, holder, holders);
        result.items.push(holderItem);
        // GTIN держателя: тот, что уже стоит, иначе первый из базы — он же уйдёт держателю в баркоды.
        const held =
            row.gtins.find((g) => holder.barcodes.some((b) => barcodeKey(b) === barcodeKey(g))) ?? row.gtins[0];
        for (const o of offers) {
            if (o === holder || !o.extraSlot) continue;
            result.items.push(extraDecision(row, o, held));
        }
    }
    return result;
}

function base(row: GtinBaseItem, o: BarcodeOffer, slot: GtinCheckItem['slot'], current: string | null): GtinCheckItem {
    return {
        offer: o.offer,
        goodscode: row.goodscode,
        name: o.name,
        current,
        base: row.gtins.join(', '),
        ok: false,
        add: [],
        slot,
        marketId: o.marketId,
    };
}

/** Держателю — все GTIN базы в баркоды. */
function holderDecision(row: GtinBaseItem, holder: BarcodeOffer, holders: BarcodeOffer[]): GtinCheckItem {
    const present = new Set(holder.barcodes.map(barcodeKey));
    const item = base(row, holder, 'barcodes', holder.barcodes.length ? holder.barcodes.join(', ') : null);
    item.add = row.gtins.filter((g) => !present.has(barcodeKey(g)));
    if (!item.add.length) return { ...item, ok: true };
    if (holder.ambiguousReason) return { ...item, ambiguousReason: holder.ambiguousReason };
    const busy = item.add
        .map((g) => ({
            g,
            on: holders.find((o) => o !== holder && o.barcodes.some((b) => barcodeKey(b) === barcodeKey(g))),
        }))
        .filter((x) => x.on);
    if (busy.length) {
        const where = busy.map((x) => `${x.g} уже на ${x.on.offer}`).join('; ');
        return { ...item, ambiguousReason: `${where} — баркод не повесить на ${holder.offer}, сначала снять там` };
    }
    return { ...item, reason: `нет в баркодах: ${item.add.join(', ')}`, action: `добавить ${item.add.join(', ')}` };
}

/** Остальным карточкам товара — GTIN держателя в поле «дополнительный GTIN». */
function extraDecision(row: GtinBaseItem, o: BarcodeOffer, held: string): GtinCheckItem {
    const item = base(row, o, 'extra', o.extraGtin || null);
    const keys = new Set(row.gtins.map(barcodeKey));
    if (o.extraGtin && keys.has(barcodeKey(o.extraGtin))) return { ...item, ok: true };
    item.add = [held];
    return { ...item, reason: `нет дополнительного GTIN`, action: `дополнительный GTIN ${held}` };
}
