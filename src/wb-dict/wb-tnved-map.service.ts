import { Injectable, Logger } from '@nestjs/common';
import { WbSubject } from '../interfaces/i.wb.dict.context';
import { WbCategoriesRepository, WbSubjectTnved } from './wb-categories.repository';

/** Предмет, в котором код проходит, с пометкой ВБ «нужен код маркировки». */
export interface WbSubjectHit extends WbSubject {
    isKiz: boolean;
}

/** Как нашли: точный код, либо по началу (6 или 4 знака), когда точного нет ни у одного предмета. */
export type WbTnvedMatch = 'exact' | 'prefix6' | 'prefix4' | 'none';

export interface WbTnvedLookup {
    tnved: string;
    match: WbTnvedMatch;
    subjects: WbSubjectHit[];
}

/** Порядок поиска по убыванию точности. Длина 10 — сам код. */
const PREFIXES: { length: number; match: WbTnvedMatch }[] = [
    { length: 10, match: 'exact' },
    { length: 6, match: 'prefix6' },
    { length: 4, match: 'prefix4' },
];

/**
 * Чистая часть поиска: карта «код → предметы» + запрос. Вынесена ради теста.
 * Совпадения по началу кода собираются со всех кодов, начинающихся так же, без повторов предметов.
 */
export function lookupTnved(codes: Map<string, WbSubjectHit[]>, tnved: string): WbTnvedLookup {
    const code = String(tnved ?? '').replace(/\D/g, '');
    for (const { length, match } of PREFIXES) {
        if (code.length < length) continue;
        const prefix = code.slice(0, length);
        const seen = new Map<number, WbSubjectHit>();
        for (const [key, hits] of codes) {
            if (!key.startsWith(prefix)) continue;
            for (const hit of hits) if (!seen.has(hit.id)) seen.set(hit.id, hit);
        }
        if (seen.size) {
            const subjects = [...seen.values()].sort((a, b) => a.commission - b.commission || a.name.localeCompare(b.name, 'ru'));
            return { tnved: code, match, subjects };
        }
    }
    return { tnved: code, match: 'none', subjects: [] };
}

/** Собрать карту из предметов со справочником. Чистая, ради теста. */
export function buildTnvedMap(rows: WbSubjectTnved[]): Map<string, WbSubjectHit[]> {
    const codes = new Map<string, WbSubjectHit[]>();
    for (const { tnved, ...subject } of rows) {
        for (const entry of tnved) {
            const list = codes.get(entry.tnved) ?? [];
            list.push({ ...subject, isKiz: entry.isKiz });
            codes.set(entry.tnved, list);
        }
    }
    return codes;
}

/**
 * Карта «ТН ВЭД → предметы ВБ» в памяти процесса. Источник — WB_CATEGORIES (патч 54);
 * собирается из базы при первом обращении и после каждой выкачки справочника.
 * Redis тут не нужен: база — точка правды, карта строится из неё за секунды.
 */
@Injectable()
export class WbTnvedMapService {
    private readonly logger = new Logger(WbTnvedMapService.name);
    private codes: Map<string, WbSubjectHit[]> | null = null;

    constructor(private readonly repo: WbCategoriesRepository) {}

    /** Пересобрать из базы. Возвращает число разных кодов. */
    async rebuild(): Promise<number> {
        const rows = await this.repo.listWithTnved();
        this.codes = buildTnvedMap(rows);
        this.logger.log(`[wb-dict] карта ТН ВЭД: предметов ${rows.length}, кодов ${this.codes.size}`);
        return this.codes.size;
    }

    async find(tnved: string): Promise<WbTnvedLookup> {
        if (!this.codes) await this.rebuild();
        return lookupTnved(this.codes, tnved);
    }
}
