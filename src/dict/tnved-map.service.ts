import { Injectable, Logger } from '@nestjs/common';
import { GoodServiceEnum } from '../good/good.service.enum';
import { DictSubject, DictSubjectTnved, ITnvedDictionary } from '../interfaces/i.tnved.dictionary';

/** Предмет, в котором код проходит, с пометкой «нужен код маркировки». */
export interface DictSubjectHit extends DictSubject {
    isKiz: boolean;
}

/** Как нашли: точный код, либо по началу (6 или 4 знака), когда точного нет ни у одного предмета. */
export type TnvedMatch = 'exact' | 'prefix6' | 'prefix4' | 'none';

export interface TnvedLookup {
    market: GoodServiceEnum;
    tnved: string;
    match: TnvedMatch;
    subjects: DictSubjectHit[];
}

export type TnvedCodeMap = Map<string, DictSubjectHit[]>;

/** Порядок поиска по убыванию точности. Длина 10 — сам код. */
const PREFIXES: { length: number; match: TnvedMatch }[] = [
    { length: 10, match: 'exact' },
    { length: 6, match: 'prefix6' },
    { length: 4, match: 'prefix4' },
];

/**
 * Чистая часть поиска: карта «код → предметы» + запрос. Вынесена ради теста.
 * Совпадения по началу кода собираются со всех кодов, начинающихся так же, без повторов предметов.
 * Сортировка: по комиссии (без комиссии — в конец), потом по имени.
 */
export function lookupTnved(codes: TnvedCodeMap, tnved: string): Omit<TnvedLookup, 'market'> {
    const code = String(tnved ?? '').replace(/\D/g, '');
    for (const { length, match } of PREFIXES) {
        if (code.length < length) continue;
        const prefix = code.slice(0, length);
        const seen = new Map<number, DictSubjectHit>();
        for (const [key, hits] of codes) {
            if (!key.startsWith(prefix)) continue;
            for (const hit of hits) if (!seen.has(hit.id)) seen.set(hit.id, hit);
        }
        if (seen.size) {
            const subjects = [...seen.values()].sort(
                (a, b) => (a.commission ?? Infinity) - (b.commission ?? Infinity) || a.name.localeCompare(b.name, 'ru'),
            );
            return { tnved: code, match, subjects };
        }
    }
    return { tnved: code, match: 'none', subjects: [] };
}

/** Собрать карту из предметов со справочником. Чистая, ради теста. */
export function buildTnvedMap(rows: DictSubjectTnved[]): TnvedCodeMap {
    const codes: TnvedCodeMap = new Map();
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
 * Карты «ТН ВЭД → предметы» по рынкам в памяти процесса. Источник — таблица предметов рынка;
 * карта собирается из базы при первом обращении и после каждой выкачки справочника.
 * Redis не нужен: база — точка правды, карта строится из неё за секунды.
 */
@Injectable()
export class TnvedMapService {
    private readonly logger = new Logger(TnvedMapService.name);
    private readonly maps = new Map<GoodServiceEnum, TnvedCodeMap>();

    /** Пересобрать карту рынка из базы. Возвращает число разных кодов. */
    async rebuild(service: ITnvedDictionary): Promise<number> {
        const rows = await service.listWithTnved();
        const codes = buildTnvedMap(rows);
        this.maps.set(service.market, codes);
        this.logger.log(`[dict] ${service.market}: карта ТН ВЭД — предметов ${rows.length}, кодов ${codes.size}`);
        return codes.size;
    }

    /** Поиск по одному рынку. */
    async find(service: ITnvedDictionary, tnved: string): Promise<TnvedLookup> {
        if (!this.maps.has(service.market)) await this.rebuild(service);
        return { market: service.market, ...lookupTnved(this.maps.get(service.market), tnved) };
    }
}
