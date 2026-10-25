import { FirebirdPool } from 'ts-firebird';

export interface DbPingResult {
    ok: boolean;
    ms: number;
    error?: string;
}

/**
 * Живость базы через ТОТ ЖЕ пул, что у всего сервиса: зависший пул (25.10.2026 — 10 часов, ts-firebird 1.3.0)
 * отвечает таймаутом, а не тишиной. Запрос, не уложившийся в таймаут, не бросаем: когда пул оживёт,
 * он выполнится и вернёт соединение (иначе сама проверка съедала бы места пула).
 */
export async function pingDatabase(pool: FirebirdPool | null, timeoutMs: number): Promise<DbPingResult> {
    const started = Date.now();
    if (!pool) return { ok: false, ms: 0, error: 'база не настроена (FB_HOST)' };

    const attempt = (async () => {
        const t = await pool.getTransaction();
        try {
            await t.query('SELECT 1 FROM RDB$DATABASE', []);
        } finally {
            await t.commit(true).catch(() => undefined);
        }
    })();
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`база не ответила за ${timeoutMs} мс`)), timeoutMs);
    });
    try {
        await Promise.race([attempt, timeout]);
        return { ok: true, ms: Date.now() - started };
    } catch (e) {
        attempt.catch(() => undefined);
        return { ok: false, ms: Date.now() - started, error: (e as Error).message };
    } finally {
        clearTimeout(timer);
    }
}
