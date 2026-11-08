import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LossStatsStore } from '../marketplace-loss/loss-stats.store';
import { OzonTariffService } from '../ozon.category/tariff.service';

/** Реальный формат TIMESTAMP из обеих рабочих баз; календарный день — только часть значения. */
const nativeDay = '2026-11-08 00:00:00.0000';
function assertTimestampWidth(sql: string) {
    for (const [, , width] of sql.matchAll(/CAST\((?:S\.)?(PERIOD_FROM|PERIOD_TO|FILE_DATE) AS VARCHAR\((\d+)\)\)/g))
        if (Number(width) < nativeDay.length) throw new Error('string right truncation');
}
function transaction(rows: unknown[]) {
    return {
        query: jest.fn(async (sql: string) => {
            assertTimestampWidth(sql);
            return rows;
        }),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
}
it('регрессия сверяется с типом колонок существующих SQL-патчей', () => {
    const loss = readFileSync(join(__dirname, '../../sql/2026-11-06_mp_loss_stats.sql'), 'utf8');
    const tariff = readFileSync(join(__dirname, '../../sql/2026-11-04_ozon_tariffs.sql'), 'utf8');
    expect(loss).toMatch(/PERIOD_FROM\s+TIMESTAMP/);
    expect(loss).toMatch(/PERIOD_TO\s+TIMESTAMP/);
    expect(tariff).toMatch(/FILE_DATE\s+TIMESTAMP/);
});
it('читает период снимка из TIMESTAMP целиком и сохраняет календарные границы', async () => {
    const t = transaction([
        {
            CALCULATED_AT: new Date(2026, 10, 8, 9, 38),
            CALCULATED_AT_TEXT: '2026-11-08 09:38:00.0070',
            PERIOD_FROM: new Date(2026, 7, 10),
            PERIOD_FROM_TEXT: '2026-08-10 00:00:00.0000',
            PERIOD_TO: new Date(2026, 10, 8),
            PERIOD_TO_TEXT: nativeDay,
        },
    ]);
    const query = t.query.getMockImplementation();
    t.query.mockImplementation(async (sql) => (sql.includes('FROM MP_LOSS_STATS') ? [] : query(sql)));
    const store = new LossStatsStore({ getTransaction: async () => t } as any);
    const result = await store.read('WB');
    expect(result.period).toEqual({ from: '2026-08-10', to: '2026-11-08' });
    expect(result.calculatedAt.toISOString()).toBe('2026-11-08T02:38:00.007Z');
    expect(t.rollback).toHaveBeenCalledWith(true);
});
it.each([nativeDay, null])('читает дату файла TIMESTAMP %s без обрезания SQL и сдвига дня', async (fileDate) => {
    const t = transaction([
        {
            KIND: 'commissions',
            FILE_NAME: 'test.xlsx',
            FILE_DATE: fileDate,
            UPLOADED_AT: new Date(2026, 10, 8, 9, 38),
            UPLOADED_AT_TEXT: '2026-11-08 09:38:00.0070',
            ROWS_COUNT: 1,
        },
    ]);
    const service = new OzonTariffService({ getTransaction: async () => t } as any, null, null, null);
    const [result] = await service.info();
    expect(result.fileDate).toBe(fileDate ? '2026-11-08' : null);
    expect(result.uploadedAt.toISOString()).toBe('2026-11-08T02:38:00.007Z');
    expect(t.commit).toHaveBeenCalledWith(true);
});
