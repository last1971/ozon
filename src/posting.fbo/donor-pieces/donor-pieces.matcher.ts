import { createHash } from 'crypto';
import { goodCode, goodQuantityCoeff } from '../../helpers/product/product.helpers';
import {
    DonorPiecesDispute,
    DonorPiecesFill,
    DonorPiecesInvoice,
    DonorPiecesLine,
    DonorPiecesResult,
    SupplyItem,
} from './donor-pieces.types';

/**
 * Номер поставки Озона в примечании счёта FORFBO: 13 цифр подряд («2000062193308 Новосибирск FORFBO»).
 * Проверено по всем живым донорам обеих баз 16.10.2026: 170 из 170 в этом виде.
 */
export function parseSupplyNumber(prim: string | null): string | null {
    const m = /(?<!\d)(\d{13})(?!\d)/.exec(prim ?? '');
    return m ? m[1] : null;
}

/** Фасовка товара в поставке: коэффициент артикула → упаковок. */
type PackUnits = Map<number, number>;

function supplyByGood(items: SupplyItem[]): Map<string, { packs: PackUnits; offers: Map<string, number> }> {
    const byGood = new Map<string, { packs: PackUnits; offers: Map<string, number> }>();
    for (const item of items) {
        const gc = goodCode({ offer_id: item.offerId });
        const coeff = goodQuantityCoeff({ offer_id: item.offerId });
        const entry = byGood.get(gc) ?? { packs: new Map(), offers: new Map() };
        entry.packs.set(coeff, (entry.packs.get(coeff) ?? 0) + item.units);
        entry.offers.set(item.offerId, (entry.offers.get(item.offerId) ?? 0) + item.units);
        byGood.set(gc, entry);
    }
    return byGood;
}

const describeOffers = (offers: Map<string, number>) =>
    [...offers.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([offer, units]) => `${offer} × ${units}`)
        .join(', ');

/**
 * Сопоставить счёт-донор с составом поставки Озона. Только данные, без базы и сети.
 *
 * По каждому товару, у которого в счёте есть строка без фасовки:
 *  - товар ехал одной фасовкой и штуки поставки (упаковки × суффикс) равны штукам счёта → фасовка
 *    всем пустым строкам товара, если их количество кратно ей;
 *  - товар ехал несколькими фасовками, строк в счёте столько же и каждая строка однозначно равна
 *    штукам одной фасовки → каждой строке своя;
 *  - иначе спор: строку не трогаем, человек разбивает руками.
 * Товар поставки, которого нет в счёте, не наш вопрос: писать некуда.
 */
export function matchSupply(
    invoice: DonorPiecesInvoice,
    items: SupplyItem[],
): { fills: DonorPiecesFill[]; disputes: DonorPiecesDispute[] } {
    const fills: DonorPiecesFill[] = [];
    const disputes: DonorPiecesDispute[] = [];
    const supply = supplyByGood(items);

    const linesByGood = new Map<string, DonorPiecesLine[]>();
    for (const line of invoice.lines) {
        linesByGood.set(line.goodscode, [...(linesByGood.get(line.goodscode) ?? []), line]);
    }

    for (const [gc, lines] of linesByGood) {
        const empty = lines.filter((l) => l.pieces === null);
        if (!empty.length) continue;
        const dispute = (reason: string) =>
            disputes.push({ realpricecode: empty.length === 1 ? empty[0].realpricecode : null, goodscode: gc, reason });

        const entry = supply.get(gc);
        if (!entry) {
            dispute('товара нет в поставке Озона');
            continue;
        }
        if ([...entry.packs.keys()].some((c) => c < 1)) {
            dispute(`непонятный артикул в поставке: ${describeOffers(entry.offers)}`);
            continue;
        }
        const supplyPieces = [...entry.packs.entries()].reduce((sum, [c, units]) => sum + c * units, 0);
        const invoicePieces = lines.reduce((sum, l) => sum + l.quantity, 0);
        if (supplyPieces !== invoicePieces) {
            dispute(`в счёте ${invoicePieces} шт, в поставке ${supplyPieces} шт (${describeOffers(entry.offers)})`);
            continue;
        }

        if (entry.packs.size === 1) {
            const [coeff] = entry.packs.keys();
            const bad = empty.filter((l) => l.quantity % coeff !== 0);
            if (bad.length) {
                dispute(`количество строки не кратно фасовке ${coeff}`);
                continue;
            }
            for (const l of empty) fills.push({ realpricecode: l.realpricecode, goodscode: gc, pieces: coeff });
            continue;
        }

        const assigned = assignByQuantity(lines, entry.packs);
        if (!assigned) {
            dispute(`товар в поставке несколькими фасовками: ${describeOffers(entry.offers)} — разбейте строку по фасовкам`);
            continue;
        }
        for (const l of empty) fills.push({ realpricecode: l.realpricecode, goodscode: gc, pieces: assigned.get(l.realpricecode) });
    }
    return { fills, disputes };
}

/**
 * Несколько фасовок одного товара: строка ↔ фасовка, только если соответствие единственное.
 * Строка уже с фасовкой обязана совпасть со своей; пустая — с единственной фасовкой той же суммы штук.
 */
function assignByQuantity(lines: DonorPiecesLine[], packs: PackUnits): Map<number, number> | null {
    if (lines.length !== packs.size) return null;
    const free = new Map(packs);
    const result = new Map<number, number>();
    const ordered = [...lines].sort((a, b) => (a.pieces === null ? 1 : 0) - (b.pieces === null ? 1 : 0));
    for (const line of ordered) {
        const candidates = [...free.entries()].filter(
            ([c, units]) => c * units === line.quantity && (line.pieces === null || line.pieces === c),
        );
        if (candidates.length !== 1) return null;
        const [coeff] = candidates[0];
        result.set(line.realpricecode, coeff);
        free.delete(coeff);
    }
    return result;
}

/**
 * Состояние для журнала MP_EVENT (часть ключа, ≤ 40 символов). У спора — отпечаток списка спорных
 * строк: та же проблема даёт то же состояние (письма нет), поменялась — новое состояние (письмо).
 */
export function journalState(result: Pick<DonorPiecesResult, 'outcome' | 'disputes'>): string {
    if (result.outcome !== 'DISPUTE') return result.outcome;
    const key = result.disputes
        .map((d) => `${d.realpricecode ?? ''}|${d.goodscode}|${d.reason}`)
        .sort()
        .join('\n');
    return `DISPUTE:${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}
