import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chunk } from 'lodash';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { isMarkCodesEnabled } from '../helpers/mark-codes.helper';

/** Вид пачки: вывод из оборота (продано) или возврат в оборот (вернулось). */
export type ChzBatchKind = 'retire' | 'return';

/** Код, ждущий передачи в ЧЗ (вывода или возврата). */
export interface ChzPendingCode {
    ki: string;
    goodsCode: string;
    /** Цена строки счёта (с НДС) — второй столбец xlsx для ГИС МТ. */
    price: number | null;
    invoiceNumber: number | null;
    posting: string | null;
    /** С какого момента код ждёт: вывод — RETIRED_AT, возврат — CHZ_SENT_AT. */
    since: Date | null;
}

export interface ChzBatchInfo {
    id: number;
    kind: ChzBatchKind;
    createdAt: Date;
    confirmedAt: Date | null;
    cnt: number;
}

/**
 * Слой данных отметки «передано в ЧЗ» (патч 39: MARKCODES.CHZ_SENT_AT,
 * CHZ_BATCH, CHZ_BATCH_KI). Единственная точка правды — состояние кода:
 *
 *   вывод:   STATUS=6, RETIRE_REASON=1, TT=3, CHZ_SENT_AT IS NULL;
 *   возврат: STATUS=5, CHZ_SENT_AT IS NOT NULL (ЧЗ ещё считает код выведенным).
 *
 * Эти два предиката живут ТОЛЬКО здесь — ими пользуются вкладка админки,
 * суточная напоминалка и недельный отчёт висяков. Подтверждение пачки
 * замыкает цикл: вывод ставит CHZ_SENT_AT, возврат снимает.
 */
@Injectable()
export class Trade2006ChzService {
    /** Гвард отбора «ждёт вывода в ЧЗ» — часть WHERE, переиспользуется подтверждением. */
    private static readonly RETIRE_GUARD = 'm.STATUS = 6 AND m.RETIRE_REASON = 1 AND m.TRANSFER_TYPE = 3 AND m.CHZ_SENT_AT IS NULL';
    /** Гвард отбора «ждёт возврата в ЧЗ». */
    private static readonly RETURN_GUARD = 'm.STATUS = 5 AND m.CHZ_SENT_AT IS NOT NULL';

    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private configService: ConfigService,
    ) {}

    private guard(kind: ChzBatchKind): string {
        return kind === 'retire' ? Trade2006ChzService.RETIRE_GUARD : Trade2006ChzService.RETURN_GUARD;
    }

    async pending(kind: ChzBatchKind, transaction: FirebirdTransaction = null): Promise<ChzPendingCode[]> {
        // Маркировка выключена (магазин) — таблиц/поля нет, слой схлопывается в ноль.
        if (!isMarkCodesEnabled(this.configService)) return [];
        const t = transaction ?? (await this.pool.getTransaction());
        const since = kind === 'retire' ? 'm.RETIRED_AT' : 'm.CHZ_SENT_AT';
        const rows = await t.query(
            `SELECT m.KI, m.GOODSCODE, rp.PRICE, s.NS, s.PRIM, ${since} AS SINCE ` +
                'FROM MARKCODES m ' +
                'LEFT JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'LEFT JOIN S s ON s.SCODE = rp.SCODE ' +
                `WHERE ${this.guard(kind)} ORDER BY ${since}, m.KI`,
            [],
            !transaction,
        );
        return rows.map((r) => ({
            ki: String(r.KI),
            goodsCode: String(r.GOODSCODE),
            price: r.PRICE === null || r.PRICE === undefined ? null : Number(r.PRICE),
            invoiceNumber: r.NS === null || r.NS === undefined ? null : Number(r.NS),
            posting: r.PRIM === null || r.PRIM === undefined ? null : String(r.PRIM).trim(),
            since: r.SINCE ?? null,
        }));
    }

    /**
     * Пачка = снимок текущего pending на момент скачивания. Подтверждение
     * работает ровно по этому списку: коды, добежавшие после, не зацепятся.
     * Пусто — пачка не создаётся.
     */
    async createBatch(kind: ChzBatchKind): Promise<{ id: number; codes: ChzPendingCode[] } | null> {
        if (!isMarkCodesEnabled(this.configService)) return null;
        const t = await this.pool.getTransaction();
        try {
            const codes = await this.pending(kind, t);
            if (!codes.length) {
                await t.rollback(true);
                return null;
            }
            const [{ ID: id }] = await t.query('SELECT GEN_ID(GEN_CHZ_BATCH, 1) AS ID FROM RDB$DATABASE', [], false);
            await t.execute('INSERT INTO CHZ_BATCH (ID, KIND, CNT) VALUES (?, ?, ?)', [id, kind, codes.length], false);
            for (const code of codes) {
                await t.execute('INSERT INTO CHZ_BATCH_KI (BATCH_ID, KI) VALUES (?, ?)', [id, code.ki], false);
            }
            await t.commit(true);
            return { id: Number(id), codes };
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    async getBatch(id: number): Promise<{ info: ChzBatchInfo; codes: { ki: string; price: number | null }[] } | null> {
        if (!isMarkCodesEnabled(this.configService)) return null;
        const t = await this.pool.getTransaction();
        const rows = await t.query('SELECT ID, KIND, CREATED_AT, CONFIRMED_AT, CNT FROM CHZ_BATCH WHERE ID = ?', [id], false);
        if (!rows.length) {
            await t.commit(true);
            return null;
        }
        const codes = await t.query(
            'SELECT k.KI, rp.PRICE FROM CHZ_BATCH_KI k ' +
                'LEFT JOIN MARKCODES m ON m.KI = k.KI ' +
                'LEFT JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'WHERE k.BATCH_ID = ? ORDER BY k.KI',
            [id],
            true,
        );
        return {
            info: this.mapBatch(rows[0]),
            codes: codes.map((r) => ({
                ki: String(r.KI),
                price: r.PRICE === null || r.PRICE === undefined ? null : Number(r.PRICE),
            })),
        };
    }

    /**
     * Подтверждение пачки. Помечаются только коды, всё ещё проходящие гвард
     * своего вида: код, успевший сменить состояние (например, вернулся между
     * скачиванием и кликом), пропускается и попадёт в следующую пачку
     * противоположного вида. Повторное подтверждение — тихий no-op.
     */
    async confirmBatch(id: number): Promise<{ confirmed: number; skipped: number; already: boolean } | null> {
        if (!isMarkCodesEnabled(this.configService)) return null;
        const t = await this.pool.getTransaction();
        try {
            const rows = await t.query('SELECT ID, KIND, CREATED_AT, CONFIRMED_AT, CNT FROM CHZ_BATCH WHERE ID = ?', [id], false);
            if (!rows.length) {
                await t.rollback(true);
                return null;
            }
            const batch = this.mapBatch(rows[0]);
            if (batch.confirmedAt) {
                await t.rollback(true);
                return { confirmed: 0, skipped: 0, already: true };
            }
            const kis = (await t.query('SELECT KI FROM CHZ_BATCH_KI WHERE BATCH_ID = ?', [id], false)).map((r) =>
                String(r.KI),
            );
            let confirmed = 0;
            for (const part of chunk(kis, 50)) {
                const inList = part.map(() => '?').join(',');
                const [{ CNT: eligible }] = await t.query(
                    `SELECT COUNT(*) AS CNT FROM MARKCODES m WHERE m.KI IN (${inList}) AND ${this.guard(batch.kind)}`,
                    part,
                    false,
                );
                confirmed += Number(eligible);
                const setSent =
                    batch.kind === 'retire' ? 'SET CHZ_SENT_AT = CURRENT_TIMESTAMP' : 'SET CHZ_SENT_AT = NULL';
                await t.execute(
                    `UPDATE MARKCODES m ${setSent} WHERE m.KI IN (${inList}) AND ${this.guard(batch.kind)}`,
                    part,
                    false,
                );
            }
            await t.execute('UPDATE CHZ_BATCH SET CONFIRMED_AT = CURRENT_TIMESTAMP WHERE ID = ?', [id], false);
            await t.commit(true);
            return { confirmed, skipped: kis.length - confirmed, already: false };
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    async listBatches(limit = 20): Promise<ChzBatchInfo[]> {
        if (!isMarkCodesEnabled(this.configService)) return [];
        const t = await this.pool.getTransaction();
        const rows = await t.query(
            `SELECT FIRST ${Number(limit)} ID, KIND, CREATED_AT, CONFIRMED_AT, CNT FROM CHZ_BATCH ORDER BY ID DESC`,
            [],
            true,
        );
        return rows.map((r) => this.mapBatch(r));
    }

    private mapBatch(r: any): ChzBatchInfo {
        return {
            id: Number(r.ID),
            kind: String(r.KIND) as ChzBatchKind,
            createdAt: r.CREATED_AT,
            confirmedAt: r.CONFIRMED_AT ?? null,
            cnt: Number(r.CNT),
        };
    }
}
