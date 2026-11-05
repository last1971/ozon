import type { LogisticsRow, PriceBand } from '../../ozon.category/tariff.xlsx';
import { normalize } from '../../ozon.category/tariff.xlsx';
import type { RouteBucket, WeightedCluster } from './ozon.routes';

export interface LogisticsCostBand extends PriceBand {
    amount: number;
    source: 'tariff' | 'tariff-default' | 'api-average' | 'api-max';
    warning?: string;
}
export function priceInBand(price: number, band: PriceBand): boolean {
    return (
        Number.isFinite(price) &&
        (band.minIncluded ? price >= band.min : price > band.min) &&
        (band.max === null || (band.maxIncluded ? price <= band.max : price < band.max))
    );
}
const bandKey = (b: PriceBand) => JSON.stringify([b.min, b.max, b.minIncluded, b.maxIncluded]);
const finiteMoney = (n: number) => Number.isFinite(n) && n >= 0;

/** Все ступени из файла. Одна формула среднего; выбор минимальной цены относится к этапу 6. */
export function weightedOzonLogistics(
    tariffs: { loaded: boolean; rows: LogisticsRow[] },
    directions: RouteBucket | null,
    origins: WeightedCluster[],
    api: { min: number; max: number },
    unavailableReason?: string,
): LogisticsCostBand[] {
    const bands = [...new Map(tariffs.rows.map((r) => [bandKey(r.band), r.band])).values()].sort(
        (a, b) => a.min - b.min,
    );
    if (!bands.length) bands.push({ min: 0, max: null, minIncluded: true, maxIncluded: false });
    for (let i = 0; i < bands.length; i++) {
        const b = bands[i],
            prev = bands[i - 1];
        if (
            !finiteMoney(b.min) ||
            (b.max !== null && (!finiteMoney(b.max) || b.max <= b.min)) ||
            (prev &&
                (prev.max === null || prev.max > b.min || (prev.max === b.min && prev.maxIncluded && b.minIncluded)))
        ) {
            throw new Error('Некорректные или пересекающиеся ступени логистики');
        }
    }
    const fallback = (band: PriceBand, average: boolean, warning: string): LogisticsCostBand => {
        if (!finiteMoney(api.max) || (average && (!finiteMoney(api.min) || api.min > api.max)))
            throw new Error('Нет корректной запасной логистики API');
        return {
            ...band,
            amount: average ? (api.min + api.max) / 2 : api.max,
            source: average ? 'api-average' : 'api-max',
            warning,
        };
    };
    return bands.map((band) => {
        if (!tariffs.loaded || !tariffs.rows.length) return fallback(band, false, 'Нет загруженного тарифа для объёма');
        if (unavailableReason) return fallback(band, false, unavailableReason);
        if (!origins.length) return fallback(band, false, 'Нет кластера склада с доступным остатком');
        if (!directions) return fallback(band, true, 'Нет истории направлений');
        if (origins.some((o) => !o.cluster || !Number.isSafeInteger(o.units) || o.units <= 0))
            throw new Error('Некорректные остатки по кластерам');
        if (
            !directions.destinations.length ||
            directions.destinations.some((d) => !Number.isSafeInteger(d.units) || d.units <= 0) ||
            directions.destinations.reduce((sum, d) => sum + d.units, 0) !== directions.units
        )
            throw new Error('Некорректное распределение направлений');
        const rates = tariffs.rows.filter((r) => bandKey(r.band) === bandKey(band));
        const totalStock = origins.reduce((sum, o) => sum + o.units, 0);
        if (!Number.isSafeInteger(totalStock)) throw new Error('Переполнение остатков');
        let sum = 0,
            usedDefault = false;
        for (const origin of origins)
            for (const dest of directions.destinations) {
                const specific = rates.filter(
                    (r) =>
                        !r.isDefault &&
                        normalize(r.origin) === normalize(origin.cluster) &&
                        normalize(r.destination) === normalize(dest.cluster),
                );
                const matching = specific.length ? specific : rates.filter((r) => r.isDefault);
                if (!matching.length) return fallback(band, false, 'Нет тарифа маршрута и тарифа по умолчанию');
                if (matching.length !== 1 || !finiteMoney(matching[0].amount))
                    throw new Error('Неоднозначный или некорректный тариф маршрута');
                usedDefault ||= !specific.length;
                sum += (origin.units / totalStock) * (dest.units / directions.units) * matching[0].amount;
            }
        if (!finiteMoney(sum)) throw new Error('Некорректная средняя логистика');
        return { ...band, amount: sum, source: usedDefault ? ('tariff-default' as const) : ('tariff' as const) };
    });
}

/** Текущее расположение свободного остатка, а не склад исторического заказа. */
export function fboOrigins(
    offer: string,
    stocks: { offer_id: string; sku: number; warehouse_id: number; present: number; reserved: number }[],
    clusters: { name: string; logistic_clusters: { warehouses: { warehouse_id: number }[] }[] }[],
): WeightedCluster[] {
    const warehouses = new Map<string, string>();
    for (const cluster of clusters) {
        if (!cluster.name?.trim() || !Array.isArray(cluster.logistic_clusters))
            throw new Error('Некорректный справочник кластеров');
        for (const group of cluster.logistic_clusters) {
            if (!Array.isArray(group.warehouses)) throw new Error('Нет складов в кластере');
            for (const warehouse of group.warehouses) {
                const id = String(warehouse.warehouse_id);
                if (!/^\d+$/.test(id)) throw new Error('Некорректный ID склада');
                if (warehouses.has(id) && warehouses.get(id) !== cluster.name)
                    throw new Error('Склад отнесён к разным кластерам');
                warehouses.set(id, cluster.name);
            }
        }
    }
    const seen = new Map<string, string>();
    const result = new Map<string, number>();
    for (const row of stocks) {
        if (row.offer_id !== offer || ![row.present, row.reserved].every((n) => Number.isSafeInteger(n) && n >= 0))
            throw new Error('Некорректный остаток FBO');
        const key = `${row.sku}:${row.warehouse_id}`,
            signature = JSON.stringify([row.present, row.reserved]);
        if (seen.has(key)) {
            if (seen.get(key) !== signature) throw new Error('Разные остатки одной строки FBO');
            continue;
        }
        seen.set(key, signature);
        const units = Math.max(0, row.present - row.reserved);
        if (!units) continue;
        const origin = warehouses.get(String(row.warehouse_id));
        if (!origin) throw new Error('Не найден кластер склада с остатком');
        result.set(origin, (result.get(origin) ?? 0) + units);
    }
    return [...result].map(([cluster, units]) => ({ cluster, units }));
}
