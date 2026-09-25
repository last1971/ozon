import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { readBlob } from '../firebird/read-blob';
import { WbSubject, WbTnvedEntry } from '../interfaces/i.wb.dict.context';
import { parseTnved, serializeTnved } from './wb-tnved.codec';

/** Предмет со своим справочником ТН ВЭД. */
export interface WbSubjectTnved extends WbSubject {
    tnved: WbTnvedEntry[];
}

/** Сколько предметов в каком состоянии — шапка вкладки «Справочник ВБ». */
export interface WbDictStats {
    subjects: number; // всего предметов в WB_CATEGORIES
    withTnved: number; // справочник качали (TNVED_AT не пуст)
    stale: number; // не качали или устарел — возьмёт следующий прогон
}

/**
 * Единственное место, где читают и пишут справочник ТН ВЭД в WB_CATEGORIES (патч 54).
 * Комиссии и имена предметов пишет Trade2006GoodService.updateWbCategory — сюда не переносим.
 */
@Injectable()
export class WbCategoriesRepository {
    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    /** Предметы на выкачку: все, либо только без справочника и с устаревшим (старше days дней). */
    async subjectsToLoad(all: boolean, days: number): Promise<WbSubject[]> {
        const stale = Math.max(0, Math.floor(days));
        const t = await this.pool.getTransaction();
        const sql =
            'SELECT ID, NAME, PARENT_NAME, COMMISSION FROM WB_CATEGORIES ' +
            (all ? '' : `WHERE TNVED_AT IS NULL OR TNVED_AT < CURRENT_TIMESTAMP - ${stale} `) +
            'ORDER BY TNVED_AT NULLS FIRST, ID';
        const rows = await t.query(sql, [], true);
        return rows.map((r: any) => this.subject(r));
    }

    /** Записать справочник предмета и время выкачки. Пустой справочник тоже запись: ВБ так ответил. */
    async saveTnved(id: number, entries: WbTnvedEntry[]): Promise<void> {
        const t = await this.pool.getTransaction();
        await t.execute('UPDATE WB_CATEGORIES SET TNVED_LIST = ?, TNVED_AT = CURRENT_TIMESTAMP WHERE ID = ?', [serializeTnved(entries), id], true);
    }

    /** Все предметы, у которых справочник качали, — сырьё для карты «код → предметы». */
    async listWithTnved(): Promise<WbSubjectTnved[]> {
        const t = await this.pool.getTransaction();
        const raw = (t as any).transaction;
        try {
            const rows = await t.query(
                'SELECT ID, NAME, PARENT_NAME, COMMISSION, TNVED_LIST FROM WB_CATEGORIES WHERE TNVED_AT IS NOT NULL ORDER BY ID',
                [],
                false,
            );
            const result: WbSubjectTnved[] = [];
            for (const r of rows) {
                result.push({ ...this.subject(r), tnved: parseTnved(await readBlob(r.TNVED_LIST, raw)) });
            }
            await t.commit(true);
            return result;
        } catch (e) {
            await t.rollback(true);
            throw e;
        }
    }

    async stats(days: number): Promise<WbDictStats> {
        const stale = Math.max(0, Math.floor(days));
        const t = await this.pool.getTransaction();
        const [row] = await t.query(
            'SELECT COUNT(*) AS SUBJECTS, ' +
                'SUM(CASE WHEN TNVED_AT IS NULL THEN 0 ELSE 1 END) AS WITH_TNVED, ' +
                `SUM(CASE WHEN TNVED_AT IS NULL OR TNVED_AT < CURRENT_TIMESTAMP - ${stale} THEN 1 ELSE 0 END) AS STALE ` +
                'FROM WB_CATEGORIES',
            [],
            true,
        );
        return { subjects: Number(row?.SUBJECTS ?? 0), withTnved: Number(row?.WITH_TNVED ?? 0), stale: Number(row?.STALE ?? 0) };
    }

    private subject(r: any): WbSubject {
        return {
            id: Number(r.ID),
            name: String(r.NAME ?? '').trim(),
            parentName: String(r.PARENT_NAME ?? '').trim(),
            commission: Number(r.COMMISSION ?? 0),
        };
    }
}
