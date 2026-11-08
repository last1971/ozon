import { addJobMetric, measureJobOperation } from '../job/job.execution';
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { calculateOzonPrices, ozonDeadZoneFloor, OzonPricingInput } from '../helpers/price/ozon.pricing';

interface CachedCalculation {
    fingerprint: string;
    minPrice: number;
    deadZoneFloor?: number;
}
/** Только чистый расчёт. Карточки, акции, тарифы, база и потери читаются до обращения к этому кешу. */
@Injectable()
export class OzonCalculationCacheService {
    private readonly scope: string;
    constructor(
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        config: ConfigService,
    ) {
        this.scope = createHash('sha256')
            .update(`${config.get('FB_HOST', '')}|${config.get('FB_BASE', '')}`)
            .digest('hex')
            .slice(0, 16);
    }
    async calculate(offer: string, input: OzonPricingInput, dependencies: unknown) {
        let fingerprint: string | undefined;
        try {
            fingerprint = createHash('sha256')
                .update(
                    JSON.stringify({ input, dependencies }, (_key, value) => {
                        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Некорректный вход');
                        return value;
                    }),
                )
                .digest('hex');
        } catch {
            /* Некорректный вход не может совпасть с ранее сохранённым корректным расчётом. */
        }
        const key = `ozon:calculation:v1:${this.scope}:${encodeURIComponent(offer)}`;
        if (fingerprint) {
            try {
                const saved = await measureJobOperation('calculationCacheReadMs', () =>
                    this.cache.get<CachedCalculation>(key),
                );
                if (
                    saved?.fingerprint === fingerprint &&
                    Number.isFinite(saved.minPrice) &&
                    saved.minPrice > 0 &&
                    (saved.deadZoneFloor === undefined ||
                        (Number.isFinite(saved.deadZoneFloor) && saved.deadZoneFloor > 300))
                )
                    return { minPrice: saved.minPrice, deadZoneFloor: saved.deadZoneFloor, cacheHit: true };
            } catch {
                /* Недоступность кеша не останавливает цену. */
            }
        }
        const started = performance.now();
        const result = calculateOzonPrices(input);
        const value = { minPrice: result.min.salePrice, deadZoneFloor: ozonDeadZoneFloor(input, result) };
        addJobMetric('calculationMs', Math.max(0, performance.now() - started));
        if (fingerprint)
            try {
                await this.cache.set(key, { fingerprint, ...value }, 2 * 3600_000);
            } catch {
                /* Оптимизация необязательна. */
            }
        return { ...value, cacheHit: false };
    }
}
