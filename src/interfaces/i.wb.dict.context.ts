import { IJobContext } from './i.job.context';

/** Одна запись справочника ТН ВЭД предмета ВБ (directory/tnved). */
export interface WbTnvedEntry {
    tnved: string;
    isKiz: boolean; // ВБ требует код маркировки для этого кода
}

/** Предмет ВБ как он лежит в WB_CATEGORIES. */
export interface WbSubject {
    id: number;
    name: string;
    parentName: string;
    commission: number;
}

/** Отчёт задач справочника: у «категорий» заполнено categories, у «ТН ВЭД» — остальное. */
export interface WbDictReport {
    categories?: number; // предметов получено с tariffs/commission
    subjects?: number; // предметов взято на выкачку
    saved?: number; // справочник получен и записан
    empty?: number; // ВБ отдал пустой справочник (записан пустым, чтобы не качать снова)
    failed?: number; // ВБ не ответил — TNVED_AT не трогали, докачается в следующий раз
    codes?: number; // разных кодов ТН ВЭД в карте после пересборки
}

/** Контекст задач справочника ВБ (JobService). */
export interface IWbDictContext extends IJobContext {
    all: boolean; // качать все предметы, а не только новые и устаревшие
    days: number; // справочник старше стольких дней считается устаревшим
    report: WbDictReport;
}
