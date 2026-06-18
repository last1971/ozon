import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';

/**
 * Общий кеш-дедуп уже обработанных сущностей маркетплейсов.
 * Redis хранит множество ключей строкой с разделителями-запятыми под
 * ключом `processed:<cacheName>:<scope>`, TTL берётся из CACHE_TTL_DAYS.
 */
@Injectable()
export class ProcessedCacheService {
    constructor(
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        private readonly configService: ConfigService,
    ) {}

    private cacheKey(cacheName: string, scope: string): string {
        return `processed:${cacheName}:${scope}`;
    }

    async load(cacheName: string, scope: string): Promise<Set<string>> {
        const cachedString = (await this.cacheManager.get<string>(this.cacheKey(cacheName, scope))) || '';
        return new Set<string>(cachedString ? cachedString.split(',') : []);
    }

    async save(cacheName: string, scope: string, processed: Set<string>): Promise<void> {
        const cacheTtlDays = this.configService.get<number>('CACHE_TTL_DAYS', 14);
        await this.cacheManager.set(
            this.cacheKey(cacheName, scope),
            Array.from(processed).join(','),
            cacheTtlDays * 24 * 60 * 60 * 1000,
        );
    }

    /**
     * Обобщённый вариант processWithCache: ключ извлекается через keyOf,
     * запись в кеш откладывается флашером до успешного commit транзакции.
     */
    async process<T>(
        cacheName: string,
        scope: string,
        items: T[],
        keyOf: (item: T) => string,
        processor: (item: T) => Promise<void>,
        flushers: (() => Promise<void>)[],
    ): Promise<void> {
        const processed = await this.load(cacheName, scope);

        for (const item of items) {
            const key = keyOf(item);
            if (processed.has(key)) {
                continue;
            }
            await processor(item);
            processed.add(key);
        }

        flushers.push(async () => {
            await this.save(cacheName, scope, processed);
        });
    }
}
