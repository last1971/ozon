import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { readBlob } from '../firebird/read-blob';
import { MpService } from './mp-event.service';

export type ReturnDecision = 'RETURN' | 'PROBLEM';

/** Решение по одной строке возврата маркетплейса — строка MP_RETURN_ACCEPT (патч 61). */
export interface ReturnAcceptRecord {
    id: number;
    service: MpService;
    extId: string;
    posting: string | null;
    scode: number | null;
    realpricecode: number | null;
    goodscode: string | null;
    units: number | null;
    pieces: number | null;
    quan: number | null;
    decision: ReturnDecision;
    kis: string[];
    retiredKis: string[];
    comment: string | null;
    spisCode: number | null;
    spisSs: 0 | 1 | null;
    spisAt: Date | null;
    username: string | null;
    createdAt: Date;
}

export type NewReturnAccept = Omit<ReturnAcceptRecord, 'id' | 'spisCode' | 'spisSs' | 'spisAt' | 'createdAt'>;

/**
 * Журнал приёма возвратов — точка правды «строка возврата обработана».
 *
 * Живёт рядом с MP_EVENT: один слой Firebird-журналов маркетплейсов. Пометки в S.PRIM
 * для этого не годятся — они уже ломали обработку отмен. Уникальность (SERVICE, EXT_ID)
 * держит база: второй приём той же строки упадёт на вставке и откатит всю транзакцию.
 */
@Injectable()
export class MpReturnAcceptStore {
    constructor(@Inject(FIREBIRD) private pool: FirebirdPool) {}

    async findMany(service: MpService, extIds: string[], t: FirebirdTransaction = null): Promise<ReturnAcceptRecord[]> {
        if (!extIds.length) return [];
        return this.withTransaction(t, async (transaction) => {
            const result: ReturnAcceptRecord[] = [];
            for (let i = 0; i < extIds.length; i += 100) {
                const part = extIds.slice(i, i + 100);
                const rows = await transaction.query(
                    `SELECT * FROM MP_RETURN_ACCEPT WHERE SERVICE = ? AND EXT_ID IN (${part.map(() => '?').join(',')})`,
                    [service, ...part],
                    false,
                );
                for (const r of rows) result.push(await this.toRecord(r, transaction));
            }
            return result;
        });
    }

    async find(service: MpService, extId: string, t: FirebirdTransaction = null): Promise<ReturnAcceptRecord | null> {
        return (await this.findMany(service, [extId], t))[0] ?? null;
    }

    /** @returns ID новой строки. */
    async insert(rec: NewReturnAccept, t: FirebirdTransaction): Promise<number> {
        const rows = await t.query(
            'INSERT INTO MP_RETURN_ACCEPT (SERVICE, EXT_ID, POSTING, SCODE, REALPRICECODE, GOODSCODE, UNITS, PIECES, QUAN,' +
                ' DECISION, KIS, RETIRED_KIS, COMMENT_TEXT, USERNAME)' +
                ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ID',
            [
                rec.service,
                rec.extId,
                rec.posting,
                rec.scode,
                rec.realpricecode,
                rec.goodscode === null ? null : Number(rec.goodscode),
                rec.units,
                rec.pieces,
                rec.quan,
                rec.decision,
                rec.kis.length ? rec.kis.join('\n') : null,
                rec.retiredKis.length ? rec.retiredKis.join('\n') : null,
                rec.comment ? rec.comment.slice(0, 500) : null,
                rec.username ? rec.username.slice(0, 80) : null,
            ],
            false,
        );
        const row: any = Array.isArray(rows) ? rows[0] : rows;
        return Number(row?.ID);
    }

    async setWriteOff(id: number, spisCode: number, ss: 0 | 1, t: FirebirdTransaction): Promise<void> {
        await t.execute(
            'UPDATE MP_RETURN_ACCEPT SET SPIS_CODE = ?, SPIS_SS = ?, SPIS_AT = CURRENT_TIMESTAMP WHERE ID = ? AND SPIS_CODE IS NULL',
            [spisCode, ss, id],
            false,
        );
    }

    private async toRecord(r: any, transaction: FirebirdTransaction): Promise<ReturnAcceptRecord> {
        const raw = (transaction as any).transaction;
        const lines = (text: string) =>
            text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
        return {
            id: Number(r.ID),
            service: String(r.SERVICE) as MpService,
            extId: String(r.EXT_ID),
            posting: r.POSTING ? String(r.POSTING) : null,
            scode: r.SCODE ?? null,
            realpricecode: r.REALPRICECODE ?? null,
            goodscode: r.GOODSCODE == null ? null : String(r.GOODSCODE),
            units: r.UNITS ?? null,
            pieces: r.PIECES ?? null,
            quan: r.QUAN ?? null,
            decision: String(r.DECISION).trim() as ReturnDecision,
            kis: lines(await readBlob(r.KIS, raw)),
            retiredKis: lines(await readBlob(r.RETIRED_KIS, raw)),
            comment: r.COMMENT_TEXT ?? null,
            spisCode: r.SPIS_CODE ?? null,
            spisSs: r.SPIS_SS == null ? null : (Number(r.SPIS_SS) as 0 | 1),
            spisAt: r.SPIS_AT ? new Date(r.SPIS_AT) : null,
            username: r.USERNAME ?? null,
            createdAt: new Date(r.CREATED_AT),
        };
    }

    private async withTransaction<T>(t: FirebirdTransaction, fn: (t: FirebirdTransaction) => Promise<T>): Promise<T> {
        if (t) return fn(t);
        const own = await this.pool.getTransaction();
        try {
            const result = await fn(own);
            await own.commit(true);
            return result;
        } catch (e) {
            await own.rollback(true).catch(() => undefined);
            throw e;
        }
    }
}
