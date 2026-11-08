import { PricingDataError } from './pricing-error';
import type { LogisticsRow, PriceBand } from '../../ozon.category/tariff.xlsx';
import { normalize } from '../../ozon.category/tariff.xlsx';
import type { RouteBucket, WeightedCluster } from './ozon.routes';

export interface LogisticsCostBand extends PriceBand {
    amount: number;
    source: 'tariff' | 'tariff-default' | 'category-average';
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
): LogisticsCostBand[] {
    if (!tariffs.loaded || !tariffs.rows.length)
        throw new PricingDataError('Нет загруженного тарифа доставки для объёма товара');
    if (!directions || !['offer', 'type'].includes(directions.scope))
        throw new PricingDataError('Нет истории направлений товара или его категории');
    if (!origins.length) throw new PricingDataError('Нет кластера склада с доступным остатком для расчёта доставки');
    const bands = [...new Map(tariffs.rows.map((r) => [bandKey(r.band), r.band])).values()].sort(
        (a, b) => a.min - b.min,
    );
    for (let i = 0; i < bands.length; i++) {
        const b = bands[i],
            prev = bands[i - 1];
        if (
            !finiteMoney(b.min) ||
            (b.max !== null && (!finiteMoney(b.max) || b.max <= b.min)) ||
            (prev &&
                (prev.max === null || prev.max > b.min || (prev.max === b.min && prev.maxIncluded && b.minIncluded)))
        ) {
            throw new PricingDataError('Некорректные или пересекающиеся ступени логистики');
        }
    }
    return bands.map((band) => {
        if (origins.some((o) => !o.cluster || !Number.isSafeInteger(o.units) || o.units <= 0))
            throw new PricingDataError('Некорректные остатки по кластерам');
        if (
            !Number.isSafeInteger(directions.units) ||
            directions.units <= 0 ||
            !directions.destinations.length ||
            directions.destinations.some((d) => !Number.isSafeInteger(d.units) || d.units <= 0) ||
            directions.destinations.reduce((sum, d) => sum + d.units, 0) !== directions.units
        )
            throw new PricingDataError('Некорректное распределение направлений');
        const rates = tariffs.rows.filter((r) => bandKey(r.band) === bandKey(band));
        const totalStock = origins.reduce((sum, o) => sum + o.units, 0);
        if (!Number.isSafeInteger(totalStock)) throw new PricingDataError('Переполнение остатков');
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
                if (!matching.length)
                    throw new PricingDataError('Нет тарифа маршрута и тарифа по умолчанию для доставки');
                if (matching.length !== 1 || !finiteMoney(matching[0].amount))
                    throw new PricingDataError('Неоднозначный или некорректный тариф маршрута');
                usedDefault ||= !specific.length;
                sum += (origin.units / totalStock) * (dest.units / directions.units) * matching[0].amount;
            }
        if (!finiteMoney(sum)) throw new PricingDataError('Некорректная средняя логистика');
        return {
            ...band,
            amount: sum,
            source: directions.scope === 'type' ? 'category-average' : usedDefault ? 'tariff-default' : 'tariff',
            ...(directions.scope === 'type' ? { warning: 'Использована средняя доставка по категории' } : {}),
        };
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
            throw new PricingDataError('Некорректный справочник кластеров');
        for (const group of cluster.logistic_clusters) {
            if (!Array.isArray(group.warehouses)) throw new PricingDataError('Нет складов в кластере');
            for (const warehouse of group.warehouses) {
                const id = String(warehouse.warehouse_id);
                if (!/^\d+$/.test(id)) throw new PricingDataError('Некорректный ID склада');
                if (warehouses.has(id) && warehouses.get(id) !== cluster.name)
                    throw new PricingDataError('Склад отнесён к разным кластерам');
                warehouses.set(id, cluster.name);
            }
        }
    }
    const seen = new Map<string, string>();
    const result = new Map<string, number>();
    for (const row of stocks) {
        if (row.offer_id !== offer || ![row.present, row.reserved].every((n) => Number.isSafeInteger(n) && n >= 0))
            throw new PricingDataError('Некорректный остаток FBO');
        const key = `${row.sku}:${row.warehouse_id}`,
            signature = JSON.stringify([row.present, row.reserved]);
        if (seen.has(key)) {
            if (seen.get(key) !== signature) throw new PricingDataError('Разные остатки одной строки FBO');
            continue;
        }
        seen.set(key, signature);
        const units = Math.max(0, row.present - row.reserved);
        if (!units) continue;
        const origin = warehouses.get(String(row.warehouse_id));
        if (!origin) throw new PricingDataError(`Не найден кластер склада ${row.warehouse_id} с остатком`);
        result.set(origin, (result.get(origin) ?? 0) + units);
    }
    return [...result].map(([cluster, units]) => ({ cluster, units }));
}
