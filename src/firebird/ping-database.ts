import { FirebirdPool } from 'ts-firebird';

export interface DbPingResult {
    ok: boolean;
    ms: number;
    error?: string;
    phase?: 'acquire' | 'query' | 'release' | 'done';
    timings?: Partial<Record<'acquire' | 'query' | 'release', number>>;
}

/**
 * Живость базы через ТОТ ЖЕ пул, что у всего сервиса: зависший пул (25.10.2026 — 10 часов, ts-firebird 1.3.0)
 * отвечает таймаутом, а не тишиной. Запрос, не уложившийся в таймаут, не бросаем: когда пул оживёт,
 * он выполнится и вернёт соединение (иначе сама проверка съедала бы места пула).
 */
export async function pingDatabase(pool: FirebirdPool | null, timeoutMs: number): Promise<DbPingResult> {
    const started = Date.now();
    if (!pool) return { ok: false, ms: 0, error: 'база не настроена (FB_HOST)' };
    let phase: DbPingResult['phase'] = 'acquire';
    let failedPhase: DbPingResult['phase'];
    let phaseStarted = started;
    const timings: DbPingResult['timings'] = {};
    const enter = (next: DbPingResult['phase']) => {
        if (phase !== 'done') timings[phase] = Date.now() - phaseStarted;
        phase = next;
        phaseStarted = Date.now();
    };
    // Копия: позднее завершение после таймаута не меняет уже выданный диагностический ответ.
    const snapshot = () => ({
        phase: failedPhase ?? phase,
        timings: { ...timings, ...(phase !== 'done' ? { [phase]: Date.now() - phaseStarted } : {}) },
    });

    const attempt = (async () => {
        const t = await pool.getTransaction();
        enter('query');
        let failure: unknown;
        try {
            await t.query('SELECT 1 FROM RDB$DATABASE', []);
        } catch (e) {
            failure = e;
            failedPhase = 'query';
        } finally {
            enter('release');
            try {
                await t.commit(true);
            } catch (e) {
                if (!failure) {
                    failure = e;
                    failedPhase = 'release';
                }
                await t.rollback(true).catch(() => undefined);
            }
        }
        enter('done');
        if (failure) throw failure;
    })();
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`база не ответила за ${timeoutMs} мс`)), timeoutMs);
    });
    try {
        await Promise.race([attempt, timeout]);
        return { ok: true, ms: Date.now() - started, ...snapshot() };
    } catch (e) {
        attempt.catch(() => undefined);
        return { ok: false, ms: Date.now() - started, error: (e as Error).message, ...snapshot() };
    } finally {
        clearTimeout(timer);
    }
}
