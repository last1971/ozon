import { pingDatabase } from './ping-database';

describe('pingDatabase', () => {
    const transaction = () => ({
        query: jest.fn().mockResolvedValue([{ 1: 1 }]),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    });

    it('живой пул — ok, транзакция закрыта с отсоединением', async () => {
        const t = transaction();
        const pool: any = { getTransaction: jest.fn().mockResolvedValue(t) };

        const result = await pingDatabase(pool, 1000);

        expect(result.ok).toBe(true);
        expect(t.query).toHaveBeenCalledWith('SELECT 1 FROM RDB$DATABASE', []);
        expect(t.commit).toHaveBeenCalledWith(true);
    });

    it('зависший пул — не ok по таймауту, а не вечное ожидание', async () => {
        const pool: any = { getTransaction: jest.fn(() => new Promise(() => undefined)) };

        const result = await pingDatabase(pool, 50);

        expect(result.ok).toBe(false);
        expect(result.error).toContain('50 мс');
        expect(result.phase).toBe('acquire');
    });

    it('опоздавшее соединение после таймаута возвращается в пул', async () => {
        const t = transaction();
        let release: (v: any) => void;
        const pool: any = { getTransaction: jest.fn(() => new Promise((resolve) => (release = resolve))) };

        expect((await pingDatabase(pool, 20)).ok).toBe(false);
        release(t);
        await new Promise((r) => setImmediate(r));

        expect(t.commit).toHaveBeenCalledWith(true);
    });

    it('ошибка базы — не ok с её текстом', async () => {
        const pool: any = { getTransaction: jest.fn().mockRejectedValue(new Error('Connection shutdown')) };

        expect(await pingDatabase(pool, 1000)).toEqual(
            expect.objectContaining({ ok: false, error: 'Connection shutdown' }),
        );
    });

    it('база не настроена — не ok', async () => {
        expect((await pingDatabase(null, 1000)).ok).toBe(false);
    });

    it.each(['query', 'release'] as const)(
        'таймаут на этапе %s: позднее завершение освобождает подключение',
        async (phase) => {
            const t = transaction();
            let complete: (v?: any) => void;
            const pending = new Promise((resolve) => {
                complete = resolve;
            });
            (phase === 'query' ? t.query : t.commit).mockImplementationOnce(() => pending as any);
            const result = await pingDatabase({ getTransaction: async () => t } as any, 20);
            expect(result).toMatchObject({ ok: false, phase });
            expect(result.timings[phase]).toBeGreaterThanOrEqual(15);
            const snapshot = JSON.stringify(result);
            complete([]);
            await new Promise((r) => setImmediate(r));
            expect(t.commit).toHaveBeenCalledWith(true);
            expect(JSON.stringify(result)).toBe(snapshot);
        },
    );

    it('ошибка SELECT сохраняет свой этап даже после освобождения подключения', async () => {
        const t = transaction();
        t.query.mockRejectedValueOnce(new Error('query failed'));
        expect(await pingDatabase({ getTransaction: async () => t } as any, 1000)).toMatchObject({
            ok: false,
            error: 'query failed',
            phase: 'query',
        });
        expect(t.commit).toHaveBeenCalledWith(true);
    });

    it('ошибка освобождения не маскируется успешным SELECT; выполняется rollback', async () => {
        const t = transaction();
        t.commit.mockRejectedValueOnce(new Error('close failed'));
        expect(await pingDatabase({ getTransaction: async () => t } as any, 1000)).toMatchObject({
            ok: false,
            error: 'close failed',
            phase: 'release',
        });
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
});
