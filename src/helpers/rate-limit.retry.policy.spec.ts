import { RateLimitRetryPolicy } from './rate-limit.retry.policy';

describe('RateLimitRetryPolicy — что делать с 429', () => {
    const policy = new RateLimitRetryPolicy();
    const r429 = (retry?: string) => ({
        status: 429,
        headers: retry === undefined ? {} : { 'x-ratelimit-retry': retry },
    });

    it('429 с заголовком → ждать столько секунд, один повтор', () => {
        expect(policy.decide(r429('18'), 1)).toBe(18000);
        expect(policy.decide(r429('18'), 2)).toBeNull();
    });

    it('без заголовка → дефолтная пауза', () => {
        expect(policy.decide(r429(), 1)).toBe(5000);
        expect(policy.decide({ status: 429, headers: { 'x-ratelimit-retry': 'мусор' } }, 1)).toBe(5000);
    });

    it('дольше потолка не ждём', () => {
        expect(policy.decide(r429('31'), 1)).toBeNull();
        expect(policy.decide(r429('30'), 1)).toBe(30000);
    });

    it('не 429 → не повторяем', () => {
        expect(policy.decide({ status: 500 }, 1)).toBeNull();
        expect(policy.decide(undefined, 1)).toBeNull();
    });

    it('другая площадка — другой заголовок и лимиты через опции', () => {
        const ozon = new RateLimitRetryPolicy({
            retryHeader: 'retry-after',
            maxRetries: 2,
            maxWaitMs: 10000,
            defaultWaitMs: 1000,
        });
        expect(ozon.decide({ status: 429, headers: { 'retry-after': '2' } }, 2)).toBe(2000);
        expect(ozon.decide({ status: 429, headers: { 'retry-after': '2' } }, 3)).toBeNull();
    });
});
