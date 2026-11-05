import { ProductInfoDto } from '../../product/dto/product.info.dto';
import { OzonReturnReport } from './ozon.return.stats';
import { calculateOzonReturnPerc } from './ozon.return.perc';
import { goodCode, goodQuantityCoeff } from '../product/product.helpers';

export interface OzonReturnValue {
    goodscode: string;
    pieces: number;
    returnPerc: number;
}

/** Ключ существующей строки OZON_PERC, включая эквивалентные артикулы «123» и «123-1». */
export function ozonReturnKey(offerId: string): Pick<OzonReturnValue, 'goodscode' | 'pieces'> {
    if (!/^[1-9]\d*(?:-[1-9]\d*)?$/.test(offerId)) throw new Error(`Некорректный артикул Ozon: ${offerId}`);
    const goodscode = goodCode({ offer_id: offerId });
    const pieces = goodQuantityCoeff({ offer_id: offerId });
    if (![Number(goodscode), pieces].every((v) => Number.isSafeInteger(v) && v <= 2147483647)) {
        throw new Error(`Артикул Ozon не помещается в ключ OZON_PERC: ${offerId}`);
    }
    return { goodscode, pieces };
}

/** Политика выбора доли: своя история → взвешенная история типа → настройка. Без продаж — настройка (0). */
export function buildOzonReturnSnapshot(
    report: OzonReturnReport,
    catalog: readonly ProductInfoDto[],
    minSales = 1,
    defaultPerc = 0,
): OzonReturnValue[] {
    calculateOzonReturnPerc({ soldUnits: 0, paidReturnUnits: 0 }, defaultPerc);
    if (!Number.isSafeInteger(minSales) || minSales < 1)
        throw new Error('OZON_RETURN_MIN_SALES должен быть целым >= 1');
    if (report.issues.length || report.rows.some((r) => r.returnPerc === null)) {
        throw new Error('Есть неоднозначные данные возвратов Ozon; прежняя статистика сохранена');
    }
    const groups = new Map<string, OzonReturnValue & { soldUnits: number; paidReturnUnits: number; typeId?: number }>();
    const get = (offerId: string) => {
        const key = ozonReturnKey(offerId);
        const id = `${key.goodscode}-${key.pieces}`;
        if (!groups.has(id)) groups.set(id, { ...key, returnPerc: 0, soldUnits: 0, paidReturnUnits: 0 });
        return groups.get(id);
    };
    for (const product of catalog) {
        const group = get(product.sku);
        if (product.typeId != null) {
            if (!Number.isSafeInteger(product.typeId) || product.typeId <= 0)
                throw new Error('Некорректный тип товара Ozon');
            if (group.typeId != null && group.typeId !== product.typeId)
                throw new Error('Разные типы у одной фасовки Ozon');
            group.typeId = product.typeId;
        }
    }
    const seen = new Set<string>();
    for (const row of report.rows) {
        if (seen.has(row.offerId)) throw new Error(`Повтор артикула в статистике: ${row.offerId}`);
        seen.add(row.offerId);
        const actual = calculateOzonReturnPerc(row);
        if (actual > 1 || row.returnPerc !== actual) throw new Error(`Некорректная доля возвратов: ${row.offerId}`);
        const group = get(row.offerId);
        group.soldUnits += row.soldUnits;
        group.paidReturnUnits += row.paidReturnUnits;
    }
    const types = new Map<number, { soldUnits: number; paidReturnUnits: number }>();
    for (const group of groups.values()) {
        calculateOzonReturnPerc(group);
        if (group.typeId == null) continue;
        const total = types.get(group.typeId) ?? { soldUnits: 0, paidReturnUnits: 0 };
        total.soldUnits += group.soldUnits;
        total.paidReturnUnits += group.paidReturnUnits;
        types.set(group.typeId, total);
    }
    return [...groups.values()].map((group) => {
        const type = types.get(group.typeId);
        const counts =
            group.soldUnits >= minSales
                ? group
                : group.soldUnits > 0 && type?.soldUnits >= minSales
                  ? type
                  : { soldUnits: 0, paidReturnUnits: 0 };
        const returnPerc = calculateOzonReturnPerc(counts, defaultPerc);
        if (returnPerc > 1) throw new Error('Доля возвратов типа превышает 100%');
        return { goodscode: group.goodscode, pieces: group.pieces, returnPerc };
    });
}
