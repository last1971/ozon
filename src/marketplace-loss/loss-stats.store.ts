import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool, ISOLATION_REPEATABLE_READ, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import { DateTime } from 'luxon';
import { FIREBIRD } from '../firebird/firebird.module';
import { calculateLossRates, lossPeriod, lossOfferKey } from '../helpers/price/marketplace.loss.stats';
import { ozonReturnKey } from '../helpers/price/ozon.return.snapshot';
import {
    ILossStatsStore,
    LossSaveHooks,
    LossSnapshot,
    StoredLossSnapshot,
    StoredLossRow,
    assertLossService,
} from './loss.contracts';

// Тот же snapshot isolation драйвера, но read вместо write: метаданные и строки одной версии.
export const LOSS_READ_ISOLATION = [...ISOLATION_REPEATABLE_READ];
LOSS_READ_ISOLATION[1] = ISOLATION_READ_COMMITTED_READ_ONLY[1];

@Injectable()
export class LossStatsStore implements ILossStatsStore {
    constructor(@Inject(FIREBIRD) protected readonly pool: FirebirdPool) {}

    async replace(snapshot: LossSnapshot, hooks: LossSaveHooks = {}): Promise<void> {
        assertLossService(snapshot.service);
        const { service, preliminary } = snapshot;
        if (typeof preliminary !== 'boolean') throw new Error('Не задана достоверность источника');
        const calculatedAt = new Date(snapshot.calculatedAt.getTime());
        const period = lossPeriod(calculatedAt);
        if (snapshot.period.from !== period.from || snapshot.period.to !== period.to)
            throw new Error('Снимок должен охватывать 90 завершённых дней на дату расчёта');
        const keys = new Set<string>();
        // Фиксируем и проверяем все значения до первой записи и до любого await.
        const rows = snapshot.rows.map((row) => {
            const offer = lossOfferKey(row.offerId);
            if (keys.has(offer)) throw new Error('Повтор фасовки в снимке');
            keys.add(offer);
            const rates = calculateLossRates(row);
            if (row.returnRate !== rates.returnRate || row.defectRate !== rates.defectRate)
                throw new Error('Процент не соответствует количествам');
            if ([row.soldUnits, row.returnedUnits, row.writtenOffUnits].some((n) => n > 2147483647))
                throw new Error('Количество не помещается в Firebird INTEGER');
            const applied = row.appliedReturnRate ?? null;
            if (applied !== null && (!Number.isFinite(applied) || applied < 0 || applied > 1))
                throw new Error('Некорректная применяемая доля возвратов');
            const key = ozonReturnKey(offer);
            if (row.returnedUnits === null && applied !== null)
                throw new Error('Нельзя применять неизвестный процент возвратов');
            const state =
                row.returnedUnits === null
                    ? 'PARTIAL'
                    : !row.soldUnits
                      ? 'NO_SALES'
                      : rates.warnings.length
                        ? 'REVIEW'
                        : 'READY';
            return [
                service,
                Number(key.goodscode),
                key.pieces,
                row.soldUnits,
                row.returnedUnits,
                row.writtenOffUnits,
                rates.returnRate,
                rates.defectRate,
                state,
                calculatedAt,
                applied,
            ];
        });
        await hooks.checkpoint?.(0, rows.length);
        const t = await this.pool.getTransaction();
        try {
            // UPDATE существующей служебной строки берёт write lock. Пустые снимки также сериализованы.
            // Конкурирующий первый INSERT даст конфликт уникальности и откат, а не два неполных снимка.
            await t.execute(
                'UPDATE OR INSERT INTO MP_LOSS_STATE (SERVICE) VALUES (?) MATCHING (SERVICE)',
                [service],
                false,
            );
            const old = await t.query('SELECT CALCULATED_AT FROM MP_LOSS_STATE WHERE SERVICE = ?', [service], false);
            if (old[0]?.CALCULATED_AT && new Date(old[0].CALCULATED_AT).getTime() >= calculatedAt.getTime())
                throw new Error('Уже сохранён такой же или более новый снимок');
            await t.execute('DELETE FROM MP_LOSS_STATS WHERE SERVICE = ?', [service], false);
            for (let i = 0; i < rows.length; i++) {
                await t.execute(
                    'INSERT INTO MP_LOSS_STATS (SERVICE, GOODSCODE, PIECES, SOLD_UNITS, RETURNED_UNITS, WRITTEN_OFF_UNITS, RETURN_RATE, DEFECT_RATE, DATA_STATE, CALCULATED_AT, APPLIED_RETURN_RATE) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    rows[i],
                    false,
                );
                if ((i + 1) % 50 === 0) await hooks.checkpoint?.(i + 1, rows.length);
            }
            await t.execute(
                'UPDATE MP_LOSS_STATE SET CALCULATED_AT = ?, PERIOD_FROM = ?, PERIOD_TO = ?, PRELIMINARY = ? WHERE SERVICE = ?',
                [calculatedAt, period.from, period.to, preliminary ? 1 : 0, service],
                false,
            );
            await hooks.checkpoint?.(rows.length, rows.length);
            await hooks.beforeCommit?.();
            await t.commit(true);
        } catch (error) {
            await t.rollback(true).catch(() => undefined);
            throw error;
        }
    }

    async read(service: string): Promise<StoredLossSnapshot | null> {
        assertLossService(service);
        const t = await this.pool.getTransaction(LOSS_READ_ISOLATION);
        try {
            const states = await t.query('SELECT * FROM MP_LOSS_STATE WHERE SERVICE = ?', [service], false);
            const state = states[0];
            if (!state?.CALCULATED_AT) return null;
            const rows = await t.query(
                'SELECT * FROM MP_LOSS_STATS WHERE SERVICE = ? ORDER BY GOODSCODE, PIECES',
                [service],
                false,
            );
            const date = (value: Date) => DateTime.fromJSDate(value).toISODate();
            return {
                service,
                preliminary: state.PRELIMINARY === 1,
                calculatedAt: new Date(state.CALCULATED_AT),
                period:
                    state.PERIOD_FROM && state.PERIOD_TO
                        ? { from: date(state.PERIOD_FROM), to: date(state.PERIOD_TO) }
                        : null,
                rows: rows.map(
                    (row): StoredLossRow => ({
                        offerId: lossOfferKey(`${row.GOODSCODE}-${row.PIECES}`),
                        soldUnits: row.SOLD_UNITS,
                        returnedUnits: row.RETURNED_UNITS,
                        writtenOffUnits: row.WRITTEN_OFF_UNITS,
                        returnRate: row.RETURN_RATE,
                        appliedReturnRate: row.APPLIED_RETURN_RATE ?? null,
                        defectRate: row.DEFECT_RATE,
                        state: String(row.DATA_STATE).trim() as StoredLossRow['state'],
                        calculatedAt: new Date(row.CALCULATED_AT),
                        warnings:
                            row.DATA_STATE === 'MIGRATED'
                                ? ['Перенесён процент; исходные количества неизвестны']
                                : calculateLossRates({
                                      soldUnits: row.SOLD_UNITS,
                                      returnedUnits: row.RETURNED_UNITS,
                                      writtenOffUnits: row.WRITTEN_OFF_UNITS,
                                  }).warnings,
                    }),
                ),
            };
        } finally {
            await t.rollback(true);
        }
    }
}
