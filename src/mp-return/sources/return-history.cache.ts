const CACHE_MS = 5 * 60_000;
/** Промах по скану перечитывает историю, но не чаще раза в 30 с. */
const MISS_REFRESH_MS = 30_000;

/**
 * История возвратов маркетплейса в памяти — для источников, у которых нет поиска по скану
 * на стороне маркетплейса (ВБ, Яндекс): читаем историю целиком, фильтруем у себя.
 * Параллельные вызовы ждут одно чтение; сбой кэш не занимает.
 */
export class ReturnHistoryCache<T> {
    private cache: { at: number; rows: Promise<T[]> } | null = null;

    constructor(private readonly load: () => Promise<T[]>) {}

    rows(fresh = false): Promise<T[]> {
        if (fresh || !this.cache || Date.now() - this.cache.at > CACHE_MS) {
            const rows = this.load();
            this.cache = { at: Date.now(), rows };
            rows.catch(() => {
                if (this.cache?.rows === rows) this.cache = null;
            });
        }
        return this.cache.rows;
    }

    /** Строки под скан; промах — перечитать историю: посылка могла появиться после чтения. */
    async find(match: (rows: T[]) => T[]): Promise<T[]> {
        const rows = match(await this.rows());
        if (rows.length || Date.now() - (this.cache?.at ?? 0) <= MISS_REFRESH_MS) return rows;
        return match(await this.rows(true));
    }
}
