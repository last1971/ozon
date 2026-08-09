import { Inject, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { AccrualCategory, AccrualDto } from '../posting/dto/accrual.dto';
import {
    AccrualPart,
    isBody,
    PendingClassification,
    PendingVerdict,
    unitKindOf,
} from '../helpers/accrual.distribution';

/**
 * Дата из Firebird в YYYY-MM-DD по ЛОКАЛЬНОЙ зоне.
 *
 * Драйвер отдаёт полночь местного времени; toISOString() увёл бы её в UTC и на
 * MSK (+3) сдвинул на сутки назад — день 16-го стал бы 15-м. Реестр загруженных
 * дней от такого разъезжается молча, поэтому только luxon с локальной зоной.
 */
const isoDate = (value: any): string =>
    value instanceof Date ? DateTime.fromJSDate(value).toISODate() : DateTime.fromISO(String(value)).toISODate();

/** Разнесение одного счёта: доли начислений, которые в него вошли. */
export interface AccrualSettleEntry {
    scode: number;
    parts: AccrualPart[];
}

/**
 * Журнал начислений Ozon (таблицы OZON_ACCRUAL*, скрипт sql/35).
 *
 * Зачем журнал: Ozon начисляет эквайринг при оплате заказа, а нетто продажи —
 * при выкупе, и между ними от 1 до 8+ дней. Разносить строго внутри недельного
 * окна нельзя: то, что не разнеслось, Ozon второй раз не пришлёт. Поэтому
 * первичка копится, а разносит её приход «тела» продажи.
 */
@Injectable()
export class Trade2006AccrualService {
    private logger = new Logger(Trade2006AccrualService.name);

    constructor(@Inject(FIREBIRD) private pool: FirebirdPool) {}

    /**
     * Кладёт выгрузку дня в журнал и отмечает день в реестре.
     *
     * VERDICT и SETTLED_AT в список колонок НЕ входят сознательно: UPDATE OR INSERT
     * трогает только перечисленные поля, поэтому повторная загрузка той же недели
     * не затирает уже сделанное разнесение (проверено на живой базе).
     */
    async saveDay(date: string, accruals: AccrualDto[], t: FirebirdTransaction = null): Promise<number> {
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            let done = 0;
            let lastPercent = 0;
            for (const a of accruals) {
                await transaction.execute(
                    `UPDATE OR INSERT INTO OZON_ACCRUAL
                       (ACCRUAL_ID, ACCRUAL_DATE, UNIT_NUMBER, UNIT_KIND, CATEGORY, IS_BODY, AMOUNT, RAW)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     MATCHING (ACCRUAL_ID)`,
                    [
                        String(a.accrual_id),
                        a.date,
                        (a.unit_number || '').trim() || null,
                        unitKindOf(a.unit_number),
                        String(a.accrued_category ?? ''),
                        isBody(a) ? 1 : 0,
                        parseFloat(a.total_amount?.amount ?? '0') || 0,
                        JSON.stringify(a),
                    ],
                );
                done++;
                const percent = Math.floor((done / accruals.length) * 10) * 10;
                if (percent > lastPercent) {
                    this.logger.log(`saveDay ${date}: ${percent}% (${done}/${accruals.length})`);
                    lastPercent = percent;
                }
            }
            await transaction.execute(
                // Оба параметра обязаны быть в CAST: у нетипизированного placeholder
                // в списке выборки Firebird не выводит тип и падает с -804.
                `MERGE INTO OZON_ACCRUAL_DAY d
                 USING (SELECT CAST(? AS DATE) AS DT, CAST(? AS INTEGER) AS CNT FROM RDB$DATABASE) s
                    ON d.ACCRUAL_DATE = s.DT
                  WHEN MATCHED THEN UPDATE SET d.ROWS_LOADED = s.CNT, d.LOADED_AT = CURRENT_TIMESTAMP
                  WHEN NOT MATCHED THEN INSERT (ACCRUAL_DATE, ROWS_LOADED) VALUES (s.DT, s.CNT)`,
                [date, accruals.length],
            );
            if (!t) await transaction.commit(true);
            return accruals.length;
        } catch (e) {
            if (!t) await transaction.rollback(true);
            throw e;
        }
    }

    /**
     * Дни периода, которых нет в реестре. Пропущенная неделя молча съедает
     * эквайринг тех заказов, чьё тело придёт позже, поэтому непрерывность
     * проверяем, а не помним.
     */
    async getMissingDays(from: string, to: string, t: FirebirdTransaction = null): Promise<string[]> {
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            // третий аргумент — автокоммит: коммитим только свою транзакцию, чужую не трогаем
            const rows = await transaction.query(
                'SELECT ACCRUAL_DATE FROM OZON_ACCRUAL_DAY WHERE ACCRUAL_DATE BETWEEN ? AND ?',
                [from, to],
                !t,
            );
            const loaded = new Set<string>(rows.map((r) => isoDate(r.ACCRUAL_DATE)));
            if (!loaded.size) return []; // журнал ещё не начинали — сравнивать не с чем

            // Дырка — это пропуск ВНУТРИ покрытого периода. Дни до самой ранней
            // загрузки пропуском не считаются: журнал тогда просто не вёлся, и на
            // первом прогоне иначе сыплется вся история за окно проверки.
            const earliest = [...loaded].sort()[0];
            const start = earliest > from ? earliest : from;

            const missing: string[] = [];
            for (let day = DateTime.fromISO(start); day <= DateTime.fromISO(to); day = day.plus({ days: 1 })) {
                const iso = day.toISODate();
                if (!loaded.has(iso)) missing.push(iso);
            }
            return missing;
        } catch (e) {
            if (!t) await transaction.rollback(true);
            throw e;
        }
    }

    /**
     * Неразнесённые записи: и загруженные в этом прогоне, и осевшие в прошлых.
     *
     * Восстанавливаем ровно те поля, которые нужны distributeAccruals. Блок posting
     * синтезируем по флагу IS_BODY: разбирать RAW по каждой строке дорого (это блоб,
     * по потоку на запись), а внутрь тела считалка всё равно не заглядывает — сумма
     * там уже нетто. RAW остаётся для разбора руками.
     */
    async getUnsettled(t: FirebirdTransaction = null): Promise<AccrualDto[]> {
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            const rows = await transaction.query(
                `SELECT ACCRUAL_ID, ACCRUAL_DATE, UNIT_NUMBER, CATEGORY, IS_BODY, AMOUNT
                   FROM OZON_ACCRUAL
                  WHERE SETTLED_AT IS NULL
                    AND (VERDICT IS NULL OR VERDICT IN (?, ?))`,
                [PendingVerdict.WAITING, PendingVerdict.STALE],
                !t,
            );
            return rows.map((r) => this.toDto(r));
        } catch (e) {
            if (!t) await transaction.rollback(true);
            throw e;
        }
    }

    /** Фиксирует разнесение: доли в OZON_ACCRUAL_PART, отметку в журнале. */
    async settle(entries: AccrualSettleEntry[], t: FirebirdTransaction = null): Promise<void> {
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            let done = 0;
            let lastPercent = 0;
            for (const entry of entries) {
                for (const part of entry.parts) {
                    await transaction.execute(
                        `UPDATE OR INSERT INTO OZON_ACCRUAL_PART (ACCRUAL_ID, SCODE, AMOUNT)
                         VALUES (?, ?, ?) MATCHING (ACCRUAL_ID, SCODE)`,
                        [String(part.accrualId), entry.scode, part.amount],
                    );
                    await transaction.execute(
                        `UPDATE OZON_ACCRUAL SET SETTLED_AT = CURRENT_TIMESTAMP, VERDICT = NULL
                          WHERE ACCRUAL_ID = ?`,
                        [String(part.accrualId)],
                    );
                }
                done++;
                const percent = Math.floor((done / entries.length) * 10) * 10;
                if (percent > lastPercent) {
                    this.logger.log(`settle: ${percent}% (${done}/${entries.length})`);
                    lastPercent = percent;
                }
            }
            if (!t) await transaction.commit(true);
        } catch (e) {
            if (!t) await transaction.rollback(true);
            throw e;
        }
    }

    /**
     * Проставляет вердикт ожидающим. SETTLED_AT здесь не ставим: он означает
     * «деньги ушли в счёт». RETURNED, CLOSED и NO_INVOICE уходят из ожидания
     * по вердикту, их выборка getUnsettled уже не поднимет.
     */
    async applyVerdicts(classifications: PendingClassification[], t: FirebirdTransaction = null): Promise<void> {
        const byVerdict = new Map<PendingVerdict, number[]>();
        for (const c of classifications) {
            const ids = byVerdict.get(c.verdict);
            if (ids) ids.push(c.accrual.accrual_id);
            else byVerdict.set(c.verdict, [c.accrual.accrual_id]);
        }
        for (const [verdict, ids] of byVerdict) {
            await this.setVerdict(ids, verdict, t);
        }
    }

    /**
     * Помечает записи вердиктом по их id.
     *
     * Нужен и для тел, чей счёт оказался отменён: они не проходят через
     * classifyPending (это не ожидающие, а разнесение), и без пометки всплывали
     * бы в «не оплачено» каждый прогон — за неделю 13–19.07 таких было 4.
     */
    async setVerdict(accrualIds: number[], verdict: PendingVerdict, t: FirebirdTransaction = null): Promise<void> {
        if (!accrualIds.length) return;
        const transaction = t ?? (await this.pool.getTransaction());
        try {
            let done = 0;
            let lastPercent = 0;
            for (const id of accrualIds) {
                await transaction.execute('UPDATE OZON_ACCRUAL SET VERDICT = ? WHERE ACCRUAL_ID = ?', [
                    verdict,
                    String(id),
                ]);
                done++;
                const percent = Math.floor((done / accrualIds.length) * 10) * 10;
                if (percent > lastPercent) {
                    this.logger.log(`setVerdict ${verdict}: ${percent}% (${done}/${accrualIds.length})`);
                    lastPercent = percent;
                }
            }
            if (!t) await transaction.commit(true);
        } catch (e) {
            if (!t) await transaction.rollback(true);
            throw e;
        }
    }

    private toDto(row: any): AccrualDto {
        const dto: AccrualDto = {
            accrual_id: Number(row.ACCRUAL_ID),
            date: isoDate(row.ACCRUAL_DATE),
            total_amount: { amount: String(row.AMOUNT), currency: 'RUB' },
            unit_number: row.UNIT_NUMBER ?? '',
            accrued_category: row.CATEGORY as AccrualCategory,
        };
        if (row.IS_BODY === 1) dto.posting = { products: [{ commission: {} }] };
        return dto;
    }
}
