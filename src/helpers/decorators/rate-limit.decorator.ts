// Global cache shared across all @RateLimit decorators
const globalLastCallTimes = new Map<string, number>();

/**
 * Rate limiter decorator that prevents method calls more frequently than specified interval
 * Caches the last call time per method and enforces minimum delay between calls
 *
 * @param intervalMs - Minimum milliseconds between calls (e.g., 1000 for 1 second, 60000 for 1 minute)
 * @returns Method decorator
 *
 * @example
 * class MyService {
 *   @RateLimit(1000) // Max 1 call per second
 *   async fastMethod() { ... }
 *
 *   @RateLimit(60000) // Max 1 call per minute
 *   async slowMethod() { ... }
 * }
 */
export function RateLimit(intervalMs: number) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        const cacheKey = `${target.constructor.name}.${propertyKey}`;

        descriptor.value = async function (...args: any[]) {
            const now = Date.now();
            const lastCall = globalLastCallTimes.get(cacheKey) || 0;
            const timeSinceLastCall = now - lastCall;

            if (timeSinceLastCall < intervalMs) {
                const waitTime = intervalMs - timeSinceLastCall;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            globalLastCallTimes.set(cacheKey, Date.now());
            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}

/**
 * Clears the rate limit cache for all decorated methods.
 * Call this in beforeEach/afterEach in tests to reset rate limits between tests.
 */
export function clearRateLimitCache() {
    globalLastCallTimes.clear();
}
