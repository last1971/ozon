import { LossStatsStore, LOSS_READ_ISOLATION } from './loss-stats.store';
import { calculateLossRates } from '../helpers/price/marketplace.loss.stats';
import { LossSnapshot } from './loss.contracts';

const row = (offerId = '123', soldUnits = 10, returnedUnits = 1, writtenOffUnits = 2) => ({
    offerId,
    soldUnits,
    returnedUnits,
    writtenOffUnits,
    ...calculateLossRates({ soldUnits, returnedUnits, writtenOffUnits }),
});
const snapshot = (): LossSnapshot => ({
    service: 'WB',
    preliminary: true,
    period: { from: '2026-08-08', to: '2026-11-06' },
    calculatedAt: new Date('2026-11-06T10:00:00Z'),
    rows: [row()],
});
function setup() {
    const t = {
        query: jest.fn().mockResolvedValue([]),
        execute: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    const pool = { getTransaction: jest.fn().mockResolvedValue(t) };
    return { t, pool, store: new LossStatsStore(pool as any) };
}
describe('Единое хранилище снимков потерь', () => {
    it('снимок проходит запись и чтение с тем же UTC API, периодом и количествами', async () => {
        const { t, store } = setup();
        const source = snapshot();
        await store.replace(source);
        const nativeAt = t.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO MP_LOSS_STATS'))[1][9];
        expect(nativeAt).toBe('2026-11-06 17:00:00.000');
        t.query
            .mockResolvedValueOnce([
                {
                    CALCULATED_AT: new Date(2026, 10, 6, 17),
                    CALCULATED_AT_TEXT: nativeAt,
                    PERIOD_FROM: new Date(2026, 7, 8),
                    PERIOD_FROM_TEXT: '2026-08-08',
                    PERIOD_TO: new Date(2026, 10, 6),
                    PERIOD_TO_TEXT: '2026-11-06',
                    PRELIMINARY: 1,
                },
            ])
            .mockResolvedValueOnce([
                {
                    GOODSCODE: 123,
                    PIECES: 1,
                    SOLD_UNITS: 10,
                    RETURNED_UNITS: 1,
                    WRITTEN_OFF_UNITS: 2,
                    RETURN_RATE: 0.1,
                    DEFECT_RATE: 0.2,
                    DATA_STATE: 'READY',
                    CALCULATED_AT: new Date(2026, 10, 6, 17),
                    CALCULATED_AT_TEXT: nativeAt,
                },
            ]);
        const restored = await store.read('WB');
        expect(restored.calculatedAt.getTime()).toBe(source.calculatedAt.getTime());
        expect(restored.period).toEqual(source.period);
        expect(restored.rows[0]).toMatchObject(source.rows[0]);
        expect(restored.rows[0].calculatedAt.getTime()).toBe(source.calculatedAt.getTime());
        expect(JSON.parse(JSON.stringify(restored)).calculatedAt).toBe('2026-11-06T10:00:00.000Z');
    });

    it('одна транзакция, блокировка площадки до удаления, commit после всех строк/метаданных', async () => {
        const { t, store } = setup();
        const events: string[] = [];
        t.execute.mockImplementation(async (sql) => {
            events.push(sql.split(' ')[0]);
        });
        t.commit.mockImplementation(async () => {
            events.push('commit');
        });
        const beforeCommit = jest.fn(async () => {
            events.push('beforeCommit');
        });
        await store.replace(snapshot(), { beforeCommit });
        expect(events).toEqual(['UPDATE', 'DELETE', 'INSERT', 'UPDATE', 'beforeCommit', 'commit']);
        expect(t.execute.mock.calls[0][1]).toEqual(['WB']);
        expect(t.execute.mock.calls[1]).toEqual(['DELETE FROM MP_LOSS_STATS WHERE SERVICE = ?', ['WB'], false]);
        expect(t.execute.mock.calls[2][1]).toEqual([
            'WB',
            123,
            1,
            10,
            1,
            2,
            0.1,
            0.2,
            'READY',
            '2026-11-06 17:00:00.000',
            null,
        ]);
        expect(t.rollback).not.toHaveBeenCalled();
    });
    it.each(['OZON', 'WB', 'YANDEX', 'AVITO'])('ключ и удаление ограничены своей площадкой %s', async (service) => {
        const { t, store } = setup();
        await store.replace({ ...snapshot(), service });
        expect(t.execute.mock.calls[0][1]).toEqual([service]);
        expect(t.execute.mock.calls[1][1]).toEqual([service]);
        expect(t.execute.mock.calls[2][1][0]).toBe(service);
    });
    it('пустой новый снимок убирает устаревшие проценты и сохраняет метаданные', async () => {
        const { t, store } = setup();
        await store.replace({ ...snapshot(), rows: [] });
        expect(t.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO MP_LOSS_STATS'))).toBe(false);
        expect(t.execute.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(true);
        expect(t.commit).toHaveBeenCalledWith(true);
    });
    it('нет продаж хранится как null, а процент >100% — как REVIEW без обрезания', async () => {
        const { t, store } = setup();
        await store.replace({ ...snapshot(), rows: [row('123', 0, 1, 2), row('456', 1, 2, 3)] });
        const inserts = t.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT')).map(([, args]) => args);
        expect(inserts[0].slice(6, 9)).toEqual([null, null, 'NO_SALES']);
        expect(inserts[1].slice(6, 9)).toEqual([2, 3, 'REVIEW']);
    });
    it.each(['2026-11-06T10:00:00Z', '2026-11-06T11:00:00Z'])(
        'равный/более новый снимок %s не затирается',
        async (at) => {
            const { t, store } = setup();
            t.query.mockResolvedValue([{ CALCULATED_AT_TEXT: at, CALCULATED_AT: new Date(at) }]);
            await expect(store.replace(snapshot())).rejects.toThrow('более новый');
            expect(t.execute).toHaveBeenCalledTimes(1);
            expect(t.commit).not.toHaveBeenCalled();
            expect(t.rollback).toHaveBeenCalledWith(true);
        },
    );
    it.each(['lock', 'insert', 'metadata', 'commit'])('при ошибке %s откатывает всю транзакцию', async (stage) => {
        const { t, store } = setup();
        t.execute.mockImplementation(async (sql) => {
            if (
                (stage === 'lock' && sql.startsWith('UPDATE OR')) ||
                (stage === 'insert' && sql.startsWith('INSERT')) ||
                (stage === 'metadata' && sql.startsWith('UPDATE MP_LOSS'))
            )
                throw Error(stage);
        });
        if (stage === 'commit') t.commit.mockRejectedValue(new Error(stage));
        await expect(store.replace(snapshot())).rejects.toThrow(stage);
        expect(t.rollback).toHaveBeenCalledWith(true);
        if (stage !== 'commit') expect(t.commit).not.toHaveBeenCalled();
    });
    it('отмена перед commit вызывает rollback', async () => {
        const { store, t } = setup();
        await expect(
            store.replace(snapshot(), {
                beforeCommit: async () => {
                    throw Error('cancel');
                },
            }),
        ).rejects.toThrow('cancel');
        expect(t.commit).not.toHaveBeenCalled();
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('проверяет отмену и сообщает прогресс каждые 50 строк', async () => {
        const { store } = setup();
        const checkpoint = jest.fn(async () => {});
        await store.replace(
            { ...snapshot(), rows: Array.from({ length: 105 }, (_, i) => row(String(i + 1))) },
            { checkpoint },
        );
        expect(checkpoint.mock.calls).toEqual([
            [0, 105],
            [50, 105],
            [100, 105],
            [105, 105],
        ]);
    });
    it.each([
        { service: 'wb;' },
        { calculatedAt: new Date('bad') },
        { preliminary: undefined },
        { period: { from: '2026-10-01', to: '2026-11-06' } },
        { rows: [row('123'), row('123-1')] },
        { rows: [{ ...row(), returnRate: 0.7 }] },
        { rows: [{ ...row(), soldUnits: -1 }] },
        { rows: [{ ...row(), writtenOffUnits: 0.5 }] },
    ])('проверяет весь снимок до открытия транзакции %j', async (override) => {
        const { store, pool } = setup();
        await expect(store.replace({ ...snapshot(), ...override } as any)).rejects.toThrow();
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it('ошибка rollback не скрывает исходную ошибку', async () => {
        const { store, t } = setup();
        t.execute.mockRejectedValue(new Error('write failed'));
        t.rollback.mockRejectedValue(new Error('rollback failed'));
        await expect(store.replace(snapshot())).rejects.toThrow('write failed');
    });
    it('читает метаданные и строки в одной read-only snapshot-транзакции', async () => {
        const { store, t, pool } = setup();
        t.query
            .mockResolvedValueOnce([
                {
                    CALCULATED_AT_TEXT: snapshot().calculatedAt.toISOString(),
                    CALCULATED_AT: snapshot().calculatedAt,
                    PRELIMINARY: 1,
                    PERIOD_FROM: new Date(2026, 7, 8),
                    PERIOD_TO: new Date(2026, 10, 6),
                },
            ])
            .mockResolvedValueOnce([
                {
                    GOODSCODE: 123,
                    PIECES: 1,
                    SOLD_UNITS: 10,
                    RETURNED_UNITS: 1,
                    WRITTEN_OFF_UNITS: 2,
                    RETURN_RATE: 0.1,
                    DEFECT_RATE: 0.2,
                    DATA_STATE: 'READY',
                    CALCULATED_AT_TEXT: snapshot().calculatedAt.toISOString(),
                    CALCULATED_AT: snapshot().calculatedAt,
                },
            ]);
        expect(await store.read('WB')).toMatchObject(snapshot());
        expect(pool.getTransaction).toHaveBeenCalledWith(LOSS_READ_ISOLATION);
        expect(t.query.mock.calls.every(([, args]) => args[0] === 'WB')).toBe(true);
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('нет снимка отличается от пустого рассчитанного снимка', async () => {
        const { store, t } = setup();
        expect(await store.read('WB')).toBeNull();
        t.query
            .mockResolvedValueOnce([
                {
                    CALCULATED_AT_TEXT: snapshot().calculatedAt.toISOString(),
                    CALCULATED_AT: snapshot().calculatedAt,
                    PRELIMINARY: 1,
                },
            ])
            .mockResolvedValueOnce([]);
        expect(await store.read('WB')).toMatchObject({ rows: [] });
    });
    it('перенесённые старые проценты не получают выдуманные количества и период', async () => {
        const { store, t } = setup();
        t.query
            .mockResolvedValueOnce([
                {
                    CALCULATED_AT_TEXT: snapshot().calculatedAt.toISOString(),
                    CALCULATED_AT: snapshot().calculatedAt,
                    PRELIMINARY: 0,
                },
            ])
            .mockResolvedValueOnce([
                {
                    GOODSCODE: 123,
                    PIECES: 1,
                    SOLD_UNITS: null,
                    RETURNED_UNITS: null,
                    WRITTEN_OFF_UNITS: null,
                    RETURN_RATE: null,
                    APPLIED_RETURN_RATE: 0.25,
                    DEFECT_RATE: null,
                    DATA_STATE: 'MIGRATED',
                    CALCULATED_AT_TEXT: snapshot().calculatedAt.toISOString(),
                    CALCULATED_AT: snapshot().calculatedAt,
                },
            ]);
        expect(await store.read('OZON')).toMatchObject({
            period: null,
            rows: [
                expect.objectContaining({
                    soldUnits: null,
                    returnRate: null,
                    appliedReturnRate: 0.25,
                    defectRate: null,
                    state: 'MIGRATED',
                }),
            ],
        });
    });
});

describe('Частичные снимки без загруженных возвратов', () => {
    it.each([0, 10])('сохраняет неизвестное количество и процент возвратов как NULL, продажи %s', async (soldUnits) => {
        const { store, t } = setup();
        const partial = {
            ...row('123', soldUnits, 0, 2),
            returnedUnits: null,
            ...calculateLossRates({ soldUnits, returnedUnits: null, writtenOffUnits: 2 }),
        };
        await store.replace({ ...snapshot(), service: 'YANDEX', rows: [partial] });
        const values = t.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT'))[1];
        expect(values.slice(3, 9)).toEqual([soldUnits, null, 2, null, soldUnits ? 0.2 : null, 'PARTIAL']);
    });
    it('не позволяет передавать неизвестный процент в цены', async () => {
        const { store, pool } = setup();
        const partial = { ...row(), returnedUnits: null, returnRate: null, appliedReturnRate: 0 };
        await expect(store.replace({ ...snapshot(), rows: [partial] })).rejects.toThrow('неизвестный');
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it('читает NULL возвратов, сохраняя известный процент брака', async () => {
        const { store, t } = setup();
        t.query
            .mockResolvedValueOnce([
                {
                    CALCULATED_AT_TEXT: snapshot().calculatedAt.toISOString(),
                    CALCULATED_AT: snapshot().calculatedAt,
                    PRELIMINARY: 1,
                },
            ])
            .mockResolvedValueOnce([
                {
                    GOODSCODE: 123,
                    PIECES: 1,
                    SOLD_UNITS: 10,
                    RETURNED_UNITS: null,
                    WRITTEN_OFF_UNITS: 2,
                    RETURN_RATE: null,
                    DEFECT_RATE: 0.2,
                    DATA_STATE: 'PARTIAL',
                    CALCULATED_AT_TEXT: snapshot().calculatedAt.toISOString(),
                    CALCULATED_AT: snapshot().calculatedAt,
                },
            ]);
        expect((await store.read('YANDEX')).rows[0]).toMatchObject({
            returnedUnits: null,
            returnRate: null,
            defectRate: 0.2,
            state: 'PARTIAL',
            warnings: [expect.stringContaining('неизвестен')],
        });
    });
});
