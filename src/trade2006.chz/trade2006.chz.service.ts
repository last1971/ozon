import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chunk } from 'lodash';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { isMarkCodesEnabled } from '../helpers/mark-codes.helper';

/**
 * Вид пачки:
 *   retire     — вывод из оборота по продаже маркетплейса (FBS);
 *   return     — возврат в оборот;
 *   retire_upd — вывод из оборота по УПД покупателю вне ЧЗ (патч 42).
 * Первые два собираются по всем кодам сразу, третий — по одному документу.
 */
export type ChzBatchKind = 'retire' | 'return' | 'retire_upd';

/** Код, ждущий передачи в ЧЗ (вывода или возврата). */
export interface ChzPendingCode {
    ki: string;
    goodsCode: string;
    /** Цена строки документа (с НДС) — второй столбец xlsx для ГИС МТ. */
    price: number | null;
    invoiceNumber: number | null;
    posting: string | null;
    /** С какого момента код ждёт: вывод — RETIRED_AT, возврат — CHZ_SENT_AT. */
    since: Date | null;
}

/** УПД, по которой коды выведены и ждут выгрузки в ГИС МТ. */
export interface ChzPendingDoc {
    sfcode: number;
    nsf: number | null;
    date: Date | null;
    buyer: string | null;
    cnt: number;
    since: Date | null;
}

export interface ChzBatchInfo {
    id: number;
    kind: ChzBatchKind;
    createdAt: Date;
    confirmedAt: Date | null;
    cnt: number;
    /** Документ пачки — только у retire_upd, иначе null. */
    sfcode: number | null;
    nsf: number | null;
    date: Date | null;
}

/**
 * Слой данных отметки «передано в ЧЗ» (патч 39: MARKCODES.CHZ_SENT_AT,
 * CHZ_BATCH, CHZ_BATCH_KI; патч 42: CHZ_BATCH.SFCODE). Единственная точка
 * правды — состояние кода:
 *
 *   вывод FBS:  STATUS=6, RETIRE_REASON=1, TT=3, CHZ_SENT_AT IS NULL;
 *   вывод УПД:  STATUS=6, RETIRE_REASON=1, TT=1, CHZ_SENT_AT IS NULL;
 *   возврат:    STATUS=5, CHZ_SENT_AT IS NOT NULL (ЧЗ ещё считает код выведенным).
 *
 * Два вывода различаются ТОЛЬКО TRANSFER_TYPE. Эти предикаты живут ТОЛЬКО
 * здесь — ими пользуются вкладка админки, суточная напоминалка и недельный
 * отчёт висяков. Подтверждение пачки замыкает цикл: вывод ставит CHZ_SENT_AT,
 * возврат снимает.
 */
@Injectable()
export class Trade2006ChzService {
    /** Гвард отбора «ждёт вывода в ЧЗ» после продажи маркетплейса. */
    private static readonly RETIRE_GUARD = 'm.STATUS = 6 AND m.RETIRE_REASON = 1 AND m.TRANSFER_TYPE = 3 AND m.CHZ_SENT_AT IS NULL';
    /** Гвард отбора «ждёт вывода в ЧЗ» после УПД покупателю вне ЧЗ. */
    private static readonly RETIRE_UPD_GUARD = 'm.STATUS = 6 AND m.RETIRE_REASON = 1 AND m.TRANSFER_TYPE = 1 AND m.CHZ_SENT_AT IS NULL';
    /** Гвард отбора «ждёт возврата в ЧЗ». */
    private static readonly RETURN_GUARD = 'm.STATUS = 5 AND m.CHZ_SENT_AT IS NOT NULL';

    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private configService: ConfigService,
    ) {}

    private guard(kind: ChzBatchKind): string {
        if (kind === 'retire') return Trade2006ChzService.RETIRE_GUARD;
        if (kind === 'retire_upd') return Trade2006ChzService.RETIRE_UPD_GUARD;
        return Trade2006ChzService.RETURN_GUARD;
    }

    async pending(kind: ChzBatchKind, transaction: FirebirdTransaction = null): Promise<ChzPendingCode[]> {
        // Маркировка выключена (магазин) — таблиц/поля нет, слой схлопывается в ноль.
        if (!isMarkCodesEnabled(this.configService)) return [];
        const t = transaction ?? (await this.pool.getTransaction());
        const since = kind === 'return' ? 'm.CHZ_SENT_AT' : 'm.RETIRED_AT';
        const rows = await t.query(
            `SELECT m.KI, m.GOODSCODE, COALESCE(rpf.PRICE, rp.PRICE) AS PRICE, s.NS, s.PRIM, ${since} AS SINCE ` +
                'FROM MARKCODES m ' +
                'LEFT JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'LEFT JOIN REALPRICEF rpf ON rpf.REALPRICEFCODE = m.REALPRICEFCODE ' +
                'LEFT JOIN S s ON s.SCODE = rp.SCODE ' +
                `WHERE ${this.guard(kind)} ORDER BY ${since}, m.KI`,
            [],
            !transaction,
        );
        return rows.map((r) => this.mapCode(r));
    }

    /**
     * УПД, по которым коды выведены и ждут выгрузки в ГИС МТ. Строка списка =
     * один документ: в ГИС МТ вывод оформляется по документу, поэтому и файл
     * нужен на каждую УПД отдельно, с её номером и датой.
     */
    async pendingDocs(): Promise<ChzPendingDoc[]> {
        if (!isMarkCodesEnabled(this.configService)) return [];
        const t = await this.pool.getTransaction();
        const rows = await t.query(
            'SELECT sf.SFCODE, sf.NSF, sf.DATA, p.SHORTNAME, COUNT(*) AS CNT, MIN(m.RETIRED_AT) AS SINCE ' +
                'FROM MARKCODES m ' +
                'JOIN REALPRICEF rpf ON rpf.REALPRICEFCODE = m.REALPRICEFCODE ' +
                'JOIN SF sf ON sf.SFCODE = rpf.SFCODE ' +
                'LEFT JOIN POKUPAT p ON p.POKUPATCODE = sf.POKUPATCODE ' +
                `WHERE ${Trade2006ChzService.RETIRE_UPD_GUARD} ` +
                'GROUP BY sf.SFCODE, sf.NSF, sf.DATA, p.SHORTNAME ORDER BY sf.DATA, sf.NSF',
            [],
            true,
        );
        return rows.map((r) => ({
            sfcode: Number(r.SFCODE),
            nsf: r.NSF === null || r.NSF === undefined ? null : Number(r.NSF),
            date: r.DATA ?? null,
            buyer: r.SHORTNAME === null || r.SHORTNAME === undefined ? null : String(r.SHORTNAME).trim(),
            cnt: Number(r.CNT),
            since: r.SINCE ?? null,
        }));
    }

    /** Коды одной УПД, ждущие вывода. */
    private async docCodes(sfcode: number, t: FirebirdTransaction): Promise<ChzPendingCode[]> {
        const rows = await t.query(
            'SELECT m.KI, m.GOODSCODE, COALESCE(rpf.PRICE, rp.PRICE) AS PRICE, s.NS, s.PRIM, m.RETIRED_AT AS SINCE ' +
                'FROM MARKCODES m ' +
                'JOIN REALPRICEF rpf ON rpf.REALPRICEFCODE = m.REALPRICEFCODE ' +
                'LEFT JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'LEFT JOIN S s ON s.SCODE = rp.SCODE ' +
                `WHERE rpf.SFCODE = ? AND ${Trade2006ChzService.RETIRE_UPD_GUARD} ORDER BY m.KI`,
            [sfcode],
            false,
        );
        return rows.map((r) => this.mapCode(r));
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
            return await this.storeBatch(t, kind, codes, null);
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    /** Пачка по одной УПД: снимок её кодов, KIND='retire_upd', SFCODE документа. */
    async createDocBatch(sfcode: number): Promise<{ id: number; codes: ChzPendingCode[] } | null> {
        if (!isMarkCodesEnabled(this.configService)) return null;
        const t = await this.pool.getTransaction();
        try {
            const codes = await this.docCodes(sfcode, t);
            return await this.storeBatch(t, 'retire_upd', codes, sfcode);
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    private async storeBatch(
        t: FirebirdTransaction,
        kind: ChzBatchKind,
        codes: ChzPendingCode[],
        sfcode: number | null,
    ): Promise<{ id: number; codes: ChzPendingCode[] } | null> {
        if (!codes.length) {
            await t.rollback(true);
            return null;
        }
        const [{ ID: id }] = await t.query('SELECT GEN_ID(GEN_CHZ_BATCH, 1) AS ID FROM RDB$DATABASE', [], false);
        await t.execute('INSERT INTO CHZ_BATCH (ID, KIND, CNT, SFCODE) VALUES (?, ?, ?, ?)', [id, kind, codes.length, sfcode], false);
        for (const code of codes) {
            await t.execute('INSERT INTO CHZ_BATCH_KI (BATCH_ID, KI) VALUES (?, ?)', [id, code.ki], false);
        }
        await t.commit(true);
        return { id: Number(id), codes };
    }

    async getBatch(id: number): Promise<{ info: ChzBatchInfo; codes: { ki: string; price: number | null }[] } | null> {
        if (!isMarkCodesEnabled(this.configService)) return null;
        const t = await this.pool.getTransaction();
        const rows = await t.query(this.batchSelect('WHERE b.ID = ?'), [id], false);
        if (!rows.length) {
            await t.commit(true);
            return null;
        }
        const codes = await t.query(
            'SELECT k.KI, COALESCE(rpf.PRICE, rp.PRICE) AS PRICE FROM CHZ_BATCH_KI k ' +
                'LEFT JOIN MARKCODES m ON m.KI = k.KI ' +
                'LEFT JOIN REALPRICE rp ON rp.REALPRICECODE = m.REALPRICECODE ' +
                'LEFT JOIN REALPRICEF rpf ON rpf.REALPRICEFCODE = m.REALPRICEFCODE ' +
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
            const rows = await t.query(this.batchSelect('WHERE b.ID = ?'), [id], false);
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
                // Возврат снимает отметку, оба вывода (FBS и УПД) — ставят.
                const setSent =
                    batch.kind === 'return' ? 'SET CHZ_SENT_AT = NULL' : 'SET CHZ_SENT_AT = CURRENT_TIMESTAMP';
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
        const rows = await t.query(this.batchSelect(`ORDER BY b.ID DESC`, Number(limit)), [], true);
        return rows.map((r) => this.mapBatch(r));
    }

    /** Пачка + реквизиты её документа (для retire_upd; у остальных NULL). */
    private batchSelect(tail: string, first?: number): string {
        return (
            `SELECT ${first ? `FIRST ${first} ` : ''}b.ID, b.KIND, b.CREATED_AT, b.CONFIRMED_AT, b.CNT, b.SFCODE, ` +
            'sf.NSF, sf.DATA FROM CHZ_BATCH b LEFT JOIN SF sf ON sf.SFCODE = b.SFCODE ' +
            tail
        );
    }

    private mapCode(r: any): ChzPendingCode {
        return {
            ki: String(r.KI),
            goodsCode: String(r.GOODSCODE),
            price: r.PRICE === null || r.PRICE === undefined ? null : Number(r.PRICE),
            invoiceNumber: r.NS === null || r.NS === undefined ? null : Number(r.NS),
            posting: r.PRIM === null || r.PRIM === undefined ? null : String(r.PRIM).trim(),
            since: r.SINCE ?? null,
        };
    }

    private mapBatch(r: any): ChzBatchInfo {
        return {
            id: Number(r.ID),
            kind: String(r.KIND) as ChzBatchKind,
            createdAt: r.CREATED_AT,
            confirmedAt: r.CONFIRMED_AT ?? null,
            cnt: Number(r.CNT),
            sfcode: r.SFCODE === null || r.SFCODE === undefined ? null : Number(r.SFCODE),
            nsf: r.NSF === null || r.NSF === undefined ? null : Number(r.NSF),
            date: r.DATA ?? null,
        };
    }
}
