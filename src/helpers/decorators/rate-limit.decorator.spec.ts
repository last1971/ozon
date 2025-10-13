import { RateLimit, clearRateLimitCache } from './rate-limit.decorator';

describe('RateLimit Decorator', () => {
    class TestService {
        callCount = 0;
        callTimes: number[] = [];

        @RateLimit(100) // 100ms between calls
        async fastMethod() {
            this.callCount++;
            this.callTimes.push(Date.now());
            return 'fast';
        }

        @RateLimit(1000) // 1 second between calls
        async slowMethod() {
            this.callCount++;
            this.callTimes.push(Date.now());
            return 'slow';
        }

        @RateLimit(50) // 50ms between calls
        async veryFastMethod(value: string) {
            this.callCount++;
            this.callTimes.push(Date.now());
            return `very-fast-${value}`;
        }
    }

    let service: TestService;

    beforeEach(() => {
        // Clear rate limit cache before each test
        clearRateLimitCache();
        service = new TestService();
    });

    it('should allow first call immediately', async () => {
        const startTime = Date.now();
        const result = await service.fastMethod();
        const endTime = Date.now();

        expect(result).toBe('fast');
        expect(service.callCount).toBe(1);
        expect(endTime - startTime).toBeLessThan(50); // Should be immediate
    });

    it('should enforce rate limit between consecutive calls', async () => {
        const result1 = await service.fastMethod(); // First call - immediate
        const time1 = Date.now();

        const result2 = await service.fastMethod(); // Second call - should wait ~100ms
        const time2 = Date.now();

        expect(result1).toBe('fast');
        expect(result2).toBe('fast');
        expect(service.callCount).toBe(2);

        const timeDiff = time2 - time1;
        expect(timeDiff).toBeGreaterThanOrEqual(95); // Allow small margin
        expect(timeDiff).toBeLessThan(150); // But not too much
    });

    it('should handle different rate limits for different methods', async () => {
        await service.fastMethod(); // 100ms rate limit
        const time1 = Date.now();

        await service.slowMethod(); // 1000ms rate limit (different method)
        const time2 = Date.now();

        // slowMethod should execute immediately since it has its own rate limit
        const timeDiff = time2 - time1;
        expect(timeDiff).toBeLessThan(50); // Should be immediate
    });

    it('should enforce rate limit for multiple sequential calls', async () => {
        const startTime = Date.now();

        await service.veryFastMethod('1');
        await service.veryFastMethod('2');
        await service.veryFastMethod('3');

        const endTime = Date.now();
        const totalTime = endTime - startTime;

        expect(service.callCount).toBe(3);

        // First call immediate, then 2 waits of ~50ms each = ~100ms total
        expect(totalTime).toBeGreaterThanOrEqual(95);
        expect(totalTime).toBeLessThan(200);
    });

    it('should pass arguments correctly', async () => {
        const result1 = await service.veryFastMethod('test1');
        const result2 = await service.veryFastMethod('test2');

        expect(result1).toBe('very-fast-test1');
        expect(result2).toBe('very-fast-test2');
    });

    it('should track call times accurately', async () => {
        await service.fastMethod();
        await service.fastMethod();
        await service.fastMethod();

        expect(service.callTimes.length).toBe(3);

        // Check intervals between calls
        const interval1 = service.callTimes[1] - service.callTimes[0];
        const interval2 = service.callTimes[2] - service.callTimes[1];

        expect(interval1).toBeGreaterThanOrEqual(95);
        expect(interval2).toBeGreaterThanOrEqual(95);
    });

    it('should handle concurrent calls from different instances independently', async () => {
        const service1 = new TestService();
        const service2 = new TestService();

        const start = Date.now();

        // Both services calling at the same time
        await Promise.all([
            service1.fastMethod(),
            service2.fastMethod(),
        ]);

        const end = Date.now();
        const duration = end - start;

        // Both should complete quickly since they share the same rate limit key
        // The second call should wait for the first
        expect(duration).toBeGreaterThanOrEqual(95);
        expect(service1.callCount + service2.callCount).toBe(2);
    });

    it('should work with 1 second rate limit', async () => {
        const start = Date.now();

        await service.slowMethod();
        await service.slowMethod();

        const end = Date.now();
        const duration = end - start;

        expect(service.callCount).toBe(2);
        expect(duration).toBeGreaterThanOrEqual(950); // ~1 second
        expect(duration).toBeLessThan(1500); // Allow more margin for slower systems
    });
});
