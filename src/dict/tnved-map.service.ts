import { Injectable, Logger } from '@nestjs/common';
import { GoodServiceEnum } from '../good/good.service.enum';
import { DictSubject, DictSubjectTnved, ITnvedDictionary, TnvedEntry } from '../interfaces/i.tnved.dictionary';

/**
 * Предмет, в котором код проходит, с пометкой «нужен код маркировки» и кодами справочника,
 * по которым он сюда попал: при точном совпадении один, при поиске по началу — все с таким началом.
 * Без них по списку «по первым 4 знакам» не выбрать: не видно, какой код у предмета есть на самом деле.
 */
export interface DictSubjectHit extends DictSubject {
    isKiz: boolean;
    codes: TnvedEntry[];
}

/**
 * Элемент карты: предмет с пометкой маркировки, ОДИН объект на предмет и пометку, разделяемый
 * всеми его кодами. Пар «код + предмет» миллионы (Озон — 3.3 млн на 27.09.2026), копия на каждую
 * пару давала ~800 МБ кучи и OOM на опте (потолок 1 ГБ). Коды здесь не храним — они собираются в поиске.
 */
type MapEntry = DictSubject & { isKiz: boolean };

/** Как нашли: точный код, либо по началу (6 или 4 знака), когда точного нет ни у одного предмета. */
export type TnvedMatch = 'exact' | 'prefix6' | 'prefix4' | 'none';

export interface TnvedLookup {
    market: GoodServiceEnum;
    tnved: string;
    match: TnvedMatch;
    subjects: DictSubjectHit[];
}

export type TnvedCodeMap = Map<string, MapEntry[]>;

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
            for (const hit of hits) {
                // Копия только для найденного: элемент карты общий для всех кодов предмета.
                const found: DictSubjectHit = seen.get(hit.id) ?? { ...hit, codes: [] };
                found.codes.push({ tnved: key, isKiz: hit.isKiz });
                seen.set(hit.id, found);
            }
        }
        for (const hit of seen.values()) hit.codes.sort((a, b) => a.tnved.localeCompare(b.tnved));
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
        // Два разделяемых объекта на предмет (с маркировкой и без), а не копия на каждый код.
        const shared: Record<'kiz' | 'plain', MapEntry | undefined> = { kiz: undefined, plain: undefined };
        for (const entry of tnved) {
            const key = entry.isKiz ? 'kiz' : 'plain';
            const item = (shared[key] ??= { ...subject, isKiz: entry.isKiz });
            const list = codes.get(entry.tnved) ?? [];
            list.push(item);
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
    /**
     * Сборка, которая уже идёт, по рынку. Сборка читает справочник каждого предмета (тысячи BLOB,
     * около минуты на проде), и пока она идёт, каждый новый поиск запускал ещё одну такую же:
     * 27.09.2026 после рестарта несколько кликов «Где проходит» подряд дали параллельные сборки
     * и OOM (куча 1 ГБ на опте). Теперь ждущие поиска цепляются к идущей сборке.
     */
    private readonly building = new Map<GoodServiceEnum, Promise<number>>();

    /** Пересобрать карту рынка из базы. Возвращает число разных кодов. Параллельные вызовы делят одну сборку. */
    rebuild(service: ITnvedDictionary): Promise<number> {
        const running = this.building.get(service.market);
        if (running) return running;
        const build = (async () => {
            const rows = await service.listWithTnved();
            const codes = buildTnvedMap(rows);
            this.maps.set(service.market, codes);
            this.logger.log(`[dict] ${service.market}: карта ТН ВЭД — предметов ${rows.length}, кодов ${codes.size}`);
            return codes.size;
        })().finally(() => this.building.delete(service.market));
        this.building.set(service.market, build);
        return build;
    }

    /** Поиск по одному рынку. */
    async find(service: ITnvedDictionary, tnved: string): Promise<TnvedLookup> {
        if (!this.maps.has(service.market)) await this.rebuild(service);
        return { market: service.market, ...lookupTnved(this.maps.get(service.market), tnved) };
    }
}
