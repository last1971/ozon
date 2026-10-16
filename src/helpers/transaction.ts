import { FirebirdTransaction } from 'ts-firebird';

/**
 * Одна транзакция на кнопку: открыть, выполнить, закоммитить; любой сбой — откат целиком, ошибка наружу.
 * Единственная обёртка для ручных операций (возвраты, доноры, пересортица) — не копировать try/commit/rollback.
 */
export async function inTransaction<T>(
    open: () => Promise<FirebirdTransaction>,
    fn: (t: FirebirdTransaction) => Promise<T>,
): Promise<T> {
    const t = await open();
    try {
        const result = await fn(t);
        await t.commit(true);
        return result;
    } catch (e) {
        await t.rollback(true).catch(() => undefined);
        throw e;
    }
}
