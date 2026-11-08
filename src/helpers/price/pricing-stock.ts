import { chunk } from 'lodash';
import type { IGood } from '../../interfaces/IGood';
import { goodCode, goodQuantityCoeff } from '../product/product.helpers';

export type PricingStock =
    | { state: 'available'; marketplace: number }
    | { state: 'empty'; marketplace: 0 }
    | { state: 'unknown'; message: string };
export type PricingStocks = Map<string, PricingStock>;
const quantity = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Остатки площадки — готовые упаковки; наш свободный остаток — штуки до фасовки. */
export async function pricingStocks(
    offers: string[],
    goods: Pick<IGood, 'in'>,
    readMarketplace: (offers: string[]) => Promise<Map<string, number>>,
): Promise<PricingStocks> {
    const ids = [...new Set(offers)];
    if (!ids.length) return new Map();
    const result: PricingStocks = new Map();
    const codes = [...new Set(ids.map((offer_id) => String(goodCode({ offer_id }))))];
    const local = new Map<string, Awaited<ReturnType<IGood['in']>>[number]>();
    for (const batch of chunk(codes, 500)) {
        for (const row of await goods.in(batch, null)) local.set(String(row.code), row);
    }
    const external: string[] = [];
    for (const offer of ids) {
        const row = local.get(String(goodCode({ offer_id: offer })));
        const count = row ? quantity(row.quantity) : 0;
        const reserve = row ? quantity(row.reserve ?? 0) : 0;
        const pieces = goodQuantityCoeff({ offer_id: offer });
        if (!Number.isFinite(pieces) || pieces <= 0 || count === undefined || reserve === undefined) {
            result.set(offer, { state: 'unknown', message: 'Не удалось проверить свободный остаток на нашем складе' });
        } else if (count - reserve >= pieces) result.set(offer, { state: 'available', marketplace: 0 });
        else external.push(offer);
    }
    if (external.length) {
        try {
            const stocks = await readMarketplace(external);
            for (const offer of external) {
                const count = quantity(stocks.get(offer));
                result.set(
                    offer,
                    count === undefined
                        ? { state: 'unknown', message: 'Площадка не вернула достоверный остаток товара' }
                        : count > 0
                          ? { state: 'available', marketplace: count }
                          : { state: 'empty', marketplace: 0 },
                );
            }
        } catch {
            for (const offer of external)
                result.set(offer, { state: 'unknown', message: 'Не удалось прочитать остатки на складах площадки' });
        }
    }
    return result;
}
