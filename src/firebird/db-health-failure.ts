/** Только поля диагностики; исходный HTTP-объект с конфигурацией/заголовками не журналируем. */
export function dbHealthFailure(data: any, fallback: string): { reason: string; details: object } {
    const body = data?.message && typeof data.message === 'object' ? data.message : data;
    const error = String(body?.error ?? fallback);
    const phase = body?.phase;
    const stages = { acquire: 'получение/проверка подключения', query: 'SELECT', release: 'освобождение подключения' };
    const pool = body?.pool;
    const numberFields = (source: any, keys: string[]) =>
        Object.fromEntries(keys.filter((key) => typeof source?.[key] === 'number').map((key) => [key, source[key]]));
    const poolDetails = numberFields(pool, [
        'maxConnections',
        'activeConnections',
        'availableConnections',
        'activeTransactions',
        'utilizationPercent',
    ]);
    const details = {
        error,
        ...(typeof body?.ms === 'number' ? { ms: body.ms } : {}),
        ...(Object.hasOwnProperty.call(stages, phase) ? { phase } : {}),
        timings: numberFields(body?.timings, ['acquire', 'query', 'release']),
        pool: poolDetails,
    };
    const reason = [
        `база: ${error}`,
        ...(Object.hasOwnProperty.call(stages, phase) ? [`этап: ${stages[phase]}`] : []),
        ...(typeof pool?.activeConnections === 'number' && typeof pool?.maxConnections === 'number'
            ? [`занято подключений ${pool.activeConnections}/${pool.maxConnections}`]
            : []),
        ...(typeof pool?.activeTransactions === 'number' ? [`транзакций ${pool.activeTransactions}`] : []),
    ].join('; ');
    return { reason, details };
}
