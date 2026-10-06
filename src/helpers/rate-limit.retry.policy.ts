/** Ответ площадки, по которому решается повтор: статус и заголовки (имена в нижнем регистре, как у axios). */
export interface RateLimitedResponse {
    status?: number;
    headers?: Record<string, unknown>;
}

export interface RateLimitRetryOptions {
    /** Заголовок «повтори через N секунд». ВБ: x-ratelimit-retry. */
    retryHeader: string;
    /** Сколько повторов допустимо на один запрос. */
    maxRetries: number;
    /** Дольше этого не ждём — отдаём ошибку сразу (крон не должен виснуть на минуту). */
    maxWaitMs: number;
    /** Заголовка нет — ждём столько. */
    defaultWaitMs: number;
}

/**
 * Политика повтора при лимите площадки (429) — единственное место, где решается «ждать и повторить или
 * сдаться». Клиент только отправляет запрос и спрашивает её после ошибки. Чистая: ни сети, ни сна, ни лога.
 *
 * Чем это отличается от @RateLimit на методах: тот разводит вызовы во времени, чтобы до 429 доходило реже;
 * эта чинит 429, который всё-таки пришёл, — иначе запрос потерян и прогон крона пустой (ВБ, 06.10.2026:
 * остатки по пяти страницам каталога не ушли, список заказов пустой час подряд).
 *
 * В модуль площадки отдаётся готовым экземпляром с её настройками (useValue) — у каждой площадки свой заголовок.
 */
export class RateLimitRetryPolicy {
    static readonly WB: RateLimitRetryOptions = {
        retryHeader: 'x-ratelimit-retry',
        maxRetries: 1,
        maxWaitMs: 30_000,
        defaultWaitMs: 5_000,
    };

    constructor(private readonly options: RateLimitRetryOptions = RateLimitRetryPolicy.WB) {}

    /**
     * @param response что ответила площадка
     * @param attempt номер неудачной попытки, с 1
     * @returns сколько ждать перед повтором (мс) или null — не повторять
     */
    decide(response: RateLimitedResponse | undefined, attempt: number): number | null {
        if (response?.status !== 429) return null;
        if (attempt > this.options.maxRetries) return null;
        const wait = this.retryAfterMs(response);
        return wait <= this.options.maxWaitMs ? wait : null;
    }

    /** «Повтори через N секунд» из заголовка; нет или мусор — дефолт. */
    retryAfterMs(response: RateLimitedResponse | undefined): number {
        const raw = response?.headers?.[this.options.retryHeader];
        const seconds = Number(Array.isArray(raw) ? raw[0] : raw);
        return Number.isFinite(seconds) && seconds >= 0 && raw !== undefined && raw !== ''
            ? Math.round(seconds * 1000)
            : this.options.defaultWaitMs;
    }
}
