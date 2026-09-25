import { FirebirdPool } from 'ts-firebird';
import { readBlob } from '../firebird/read-blob';
import { DictStats, DictSubject, DictSubjectTnved, TnvedEntry } from '../interfaces/i.tnved.dictionary';
import { GoodServiceEnum } from '../good/good.service.enum';
import { parseTnved, serializeTnved } from './tnved.codec';

/** Таблица предметов рынка: имя и колонки. У всех есть TNVED_LIST/TNVED_AT (патчи 54, 55). */
export interface DictTable {
    table: string;
    id: string;
    name: string;
    parent: string;
    commission?: string; // нет — комиссия не в одной цифре (Озон)
    category?: string; // Озон: description_category_id для словаря по типу
}

/**
 * Единственное место, где читают и пишут справочник ТН ВЭД в таблице предметов.
 * Одна на все рынки: разница только в имени таблицы и колонок (DictTable).
 * Комиссии и имена предметов пишут импорты рынков — сюда не переносим.
 */
export class DictTableRepository {
    constructor(
        private readonly pool: FirebirdPool,
        private readonly market: GoodServiceEnum,
        private readonly cols: DictTable,
    ) {}

    async subjectsToLoad(all: boolean, days: number): Promise<DictSubject[]> {
        const t = await this.pool.getTransaction();
        const sql =
            `SELECT ${this.select()} FROM ${this.cols.table} ` +
            (all ? '' : `WHERE ${this.staleWhere(days)} `) +
            `ORDER BY TNVED_AT NULLS FIRST, ${this.cols.id}`;
        const rows = await t.query(sql, [], true);
        return rows.map((r: any) => this.subject(r));
    }

    async saveTnved(id: number, entries: TnvedEntry[]): Promise<void> {
        const t = await this.pool.getTransaction();
        await t.execute(
            `UPDATE ${this.cols.table} SET TNVED_LIST = ?, TNVED_AT = CURRENT_TIMESTAMP WHERE ${this.cols.id} = ?`,
            [serializeTnved(entries), id],
            true,
        );
    }

    async listWithTnved(): Promise<DictSubjectTnved[]> {
        const t = await this.pool.getTransaction();
        const raw = (t as any).transaction;
        try {
            const rows = await t.query(
                `SELECT ${this.select()}, TNVED_LIST FROM ${this.cols.table} WHERE TNVED_AT IS NOT NULL ORDER BY ${this.cols.id}`,
                [],
                false,
            );
            const result: DictSubjectTnved[] = [];
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

    async stats(days: number): Promise<DictStats> {
        const t = await this.pool.getTransaction();
        const [row] = await t.query(
            'SELECT COUNT(*) AS SUBJECTS, ' +
                'SUM(CASE WHEN TNVED_AT IS NULL THEN 0 ELSE 1 END) AS WITH_TNVED, ' +
                `SUM(CASE WHEN ${this.staleWhere(days)} THEN 1 ELSE 0 END) AS STALE ` +
                `FROM ${this.cols.table}`,
            [],
            true,
        );
        return {
            market: this.market,
            subjects: Number(row?.SUBJECTS ?? 0),
            withTnved: Number(row?.WITH_TNVED ?? 0),
            stale: Number(row?.STALE ?? 0),
        };
    }

    /** Диалект 1: типа DATE нет, арифметика по TIMESTAMP минус число дней литералом. */
    private staleWhere(days: number): string {
        return `TNVED_AT IS NULL OR TNVED_AT < CURRENT_TIMESTAMP - ${Math.max(0, Math.floor(days))}`;
    }

    private select(): string {
        const c = this.cols;
        return [
            `${c.id} AS ID`,
            `${c.name} AS NAME`,
            `${c.parent} AS PARENT_NAME`,
            c.commission ? `${c.commission} AS COMMISSION` : 'NULL AS COMMISSION',
            c.category ? `${c.category} AS CATEGORY_ID` : 'NULL AS CATEGORY_ID',
        ].join(', ');
    }

    private subject(r: any): DictSubject {
        return {
            id: Number(r.ID),
            name: String(r.NAME ?? '').trim(),
            parentName: String(r.PARENT_NAME ?? '').trim(),
            commission: r.COMMISSION == null ? null : Number(r.COMMISSION),
            categoryId: r.CATEGORY_ID == null ? undefined : Number(r.CATEGORY_ID),
        };
    }
}
