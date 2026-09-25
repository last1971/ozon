import { GoodServiceEnum } from '../good/good.service.enum';
import { IJobContext, JobProgress } from './i.job.context';

/** Одна запись справочника ТН ВЭД предмета: код + «нужен код маркировки». */
export interface TnvedEntry {
    tnved: string;
    isKiz: boolean;
}

/** Предмет (ВБ) / тип товара (Озон) как он лежит в своей таблице. */
export interface DictSubject {
    id: number;
    name: string;
    parentName: string;
    commission: number | null; // у Озона комиссия по диапазонам, в одну цифру не сводится
    categoryId?: number; // Озон: description_category_id — без него словарь по типу не спросить
}

export interface DictSubjectTnved extends DictSubject {
    tnved: TnvedEntry[];
}

/** Сколько предметов в каком состоянии — шапка вкладки. */
export interface DictStats {
    market: GoodServiceEnum;
    subjects: number; // всего предметов
    withTnved: number; // справочник качали (TNVED_AT не пуст)
    stale: number; // не качали или устарел — возьмёт следующий прогон
}

/**
 * Договор справочника маркетплейса: предметы с комиссиями и ТН ВЭД по предметам.
 * Всё рыночное (какая ручка, какая таблица, как разобрать ответ) — внутри реализации;
 * команды, карта «код → предметы» и ручки знают только этот договор. Новый рынок —
 * новая реализация + регистрация в DictService, остальное не меняется.
 */
export interface ITnvedDictionary {
    readonly market: GoodServiceEnum;
    /** Предметы и комиссии с маркетплейса → своя таблица. Возвращает, сколько предметов получено. */
    loadCategories(progress: JobProgress): Promise<number>;
    /** Предметы на выкачку справочника: все, либо без справочника и с устаревшим (старше days дней). */
    subjectsToLoad(all: boolean, days: number): Promise<DictSubject[]>;
    /** Справочник ТН ВЭД предмета с маркетплейса. null — маркетплейс не ответил. */
    directory(subject: DictSubject): Promise<TnvedEntry[] | null>;
    /** Записать справочник предмета и время выкачки. Пустой тоже запись: маркетплейс так ответил. */
    saveTnved(id: number, entries: TnvedEntry[]): Promise<void>;
    /** Все предметы, у которых справочник качали, — сырьё для карты «код → предметы». */
    listWithTnved(): Promise<DictSubjectTnved[]>;
    stats(days: number): Promise<DictStats>;
}

/** Отчёт задач справочника: у «категорий» заполнено categories, у «ТН ВЭД» — остальное. */
export interface DictReport {
    market: GoodServiceEnum;
    categories?: number; // предметов получено с маркетплейса
    subjects?: number; // предметов взято на выкачку
    saved?: number; // справочник получен и записан
    empty?: number; // маркетплейс отдал пустой справочник (записан пустым, чтобы не качать снова)
    failed?: number; // маркетплейс не ответил — TNVED_AT не трогали, докачается в следующий раз
    codes?: number; // разных кодов ТН ВЭД в карте после пересборки
}

/** Контекст задач справочника (JobService). */
export interface IDictContext extends IJobContext {
    service: ITnvedDictionary;
    all: boolean; // качать все предметы, а не только новые и устаревшие
    days: number; // справочник старше стольких дней считается устаревшим
    report: DictReport;
}
