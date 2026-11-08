import type { PostingDto } from '../../posting/dto/posting.dto';
import type { ProductInfoDto } from '../../product/dto/product.info.dto';

export type OzonScheme = 'fbs' | 'fbo';
export interface WeightedCluster {
    cluster: string;
    units: number;
}
export interface RouteBucket {
    scheme: OzonScheme;
    scope: 'offer' | 'type' | 'cabinet';
    key: string;
    units: number;
    destinations: WeightedCluster[];
}
export interface OzonRoutesSnapshot {
    version: 1;
    from: string;
    to: string;
    buckets: RouteBucket[];
    missingDirections: number;
}

/** Количество пачек артикула, без повторов отправления, отмен и умножения на фасовку. */
export function buildOzonRoutes(
    batches: { scheme: OzonScheme; postings: PostingDto[] }[],
    catalog: Pick<ProductInfoDto, 'sku' | 'typeId'>[],
    from: string,
    to: string,
): OzonRoutesSnapshot {
    const since = Date.parse(from),
        until = Date.parse(to);
    if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until)
        throw new Error('Некорректное окно направлений');
    const types = new Map(catalog.map((p) => [p.sku, p.typeId]));
    const buckets = new Map<string, RouteBucket>();
    const seen = new Map<string, string>();
    let missingDirections = 0;
    for (const { scheme, postings } of batches) {
        for (const p of postings) {
            if (p.status !== 'delivered') continue;
            const date = Date.parse(p.in_process_at);
            if (!p.posting_number || !Number.isFinite(date))
                throw new Error('Нет номера или даты заказа для логистики');
            if (date < since || date >= until) continue;
            const destination = p.financial_data?.cluster_to?.trim() ?? '';
            const products = new Map<string, number>();
            if (!Array.isArray(p.products) || !p.products.length) throw new Error('Нет товаров в доставленном заказе');
            for (const product of p.products) {
                if (!product.offer_id || !Number.isSafeInteger(product.quantity) || product.quantity <= 0)
                    throw new Error('Некорректное количество товара в заказе');
                products.set(product.offer_id, (products.get(product.offer_id) ?? 0) + product.quantity);
            }
            const id = `${scheme}:${p.posting_number}`;
            const signature = JSON.stringify([date, destination, [...products].sort(([a], [b]) => a.localeCompare(b))]);
            if (seen.has(id)) {
                if (seen.get(id) !== signature) throw new Error(`Разные данные отправления ${p.posting_number}`);
                continue;
            }
            seen.set(id, signature);
            for (const [offer, units] of products) {
                if (!destination) missingDirections += units;
                const keys: [RouteBucket['scope'], string][] = [
                    ['offer', offer],
                    ['cabinet', 'all'],
                ];
                if (types.get(offer) != null) keys.push(['type', String(types.get(offer))]);
                for (const [scope, key] of keys) {
                    const id = JSON.stringify([scheme, scope, key]);
                    const bucket = buckets.get(id) ?? { scheme, scope, key, units: 0, destinations: [] };
                    bucket.units += units;
                    if (!Number.isSafeInteger(bucket.units)) throw new Error('Переполнение количества доставок');
                    const entry = bucket.destinations.find((d) => d.cluster === destination);
                    if (entry) entry.units += units;
                    else bucket.destinations.push({ cluster: destination, units });
                    buckets.set(id, bucket);
                }
            }
        }
    }
    return { version: 1, from, to, buckets: [...buckets.values()], missingDirections };
}

export function selectOzonRoutes(
    snapshot: OzonRoutesSnapshot,
    scheme: OzonScheme,
    offer: string,
    typeId?: number,
    minUnits = 1,
): RouteBucket | null {
    if (!Number.isSafeInteger(minUnits) || minUnits < 1)
        throw new Error('OZON_LOGISTICS_MIN_UNITS должен быть целым >= 1');
    const find = (scope: RouteBucket['scope'], key: string) =>
        snapshot.buckets.find((b) => b.scheme === scheme && b.scope === scope && b.key === key);
    const own = find('offer', offer);
    if (own?.units >= minUnits) return own;
    const type = typeId == null ? null : find('type', String(typeId));
    if (type?.units >= minUnits) return type;
    return null; // Другие категории кабинета не подставляются вместо своей.
}
