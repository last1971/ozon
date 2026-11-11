import { dbHealthFailure } from './db-health-failure';

describe('Диагностика сторожа', () => {
    it.each([false, true])('сохраняет этап, времена и статистику, вложенный ответ: %s', (nested) => {
        const body = {
            error: 'timeout',
            ms: 5000,
            phase: 'acquire',
            timings: { acquire: 5000 },
            pool: { maxConnections: 15, activeConnections: 15, activeTransactions: 15 },
            headers: { Authorization: 'secret' },
        };
        const failure = dbHealthFailure(nested ? { message: body } : body, 'fallback');
        expect(failure.reason).toContain('15/15');
        expect(failure.reason).toContain('получение/проверка подключения');
        expect(failure.details).toMatchObject({ phase: 'acquire', timings: body.timings, pool: body.pool });
        expect(JSON.stringify(failure)).not.toContain('secret');
    });

    it('сетевой отказ без тела ответа остаётся понятным', () => {
        expect(dbHealthFailure(undefined, 'ECONNREFUSED').reason).toBe('база: ECONNREFUSED');
    });
});
