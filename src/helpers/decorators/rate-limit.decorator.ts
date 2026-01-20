// Global cache shared across all @RateLimit decorators
const globalLastCallTimes = new Map<string, number>();
const globalBlockedUntil = new Map<string, number>();

/**
 * Sets a rate limit block until specified timestamp.
 * Used to handle 429 responses with X-Ratelimit-Retry header.
 *
 * @param className - The class name (e.g., 'WbOrderService')
 * @param methodName - The method name (e.g., 'list')
 * @param untilTimestamp - Unix timestamp in ms until which the method should be blocked
 */
export function setRateLimitBlocked(className: string, methodName: string, untilTimestamp: number): void {
    const cacheKey = `${className}.${methodName}`;
    globalBlockedUntil.set(cacheKey, untilTimestamp);
}

/**
 * Gets the current block timestamp for a method (for testing/logging)
 */
export function getRateLimitBlockedUntil(className: string, methodName: string): number {
    const cacheKey = `${className}.${methodName}`;
    return globalBlockedUntil.get(cacheKey) || 0;
}

/**
 * Rate limiter decorator that prevents method calls more frequently than specified interval
 * Caches the last call time per method and enforces minimum delay between calls
 * Also respects blocks set via setRateLimitBlocked (for 429 handling)
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

            // Check if blocked by 429 response
            const blockedUntil = globalBlockedUntil.get(cacheKey) || 0;
            if (now < blockedUntil) {
                const blockWaitTime = blockedUntil - now;
                await new Promise(resolve => setTimeout(resolve, blockWaitTime));
            }

            // Check regular interval
            const lastCall = globalLastCallTimes.get(cacheKey) || 0;
            const timeSinceLastCall = Date.now() - lastCall;

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
    globalBlockedUntil.clear();
}
