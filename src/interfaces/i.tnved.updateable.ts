/**
 * Договор маркетплейса по ТН ВЭД: прочитать, что стоит на карточках, и записать наш код.
 * Общая часть (TnvedSyncService) знает только этот договор; словари, атрибуты, характеристики
 * и прочие особенности маркетплейса живут внутри реализации.
 */

/** Строка нашей базы: товар + его ТН ВЭД + маркируемость. Источник истины. */
export interface TnvedBaseItem {
    goodscode: string;
    tnved: string;
    markRequired: boolean;
}

/**
 * Решение маркетплейса по одной карточке. Маркетплейс сам решает, «ок» ли карточка:
 * у Озона это не совпадение цифр, а нужный вариант словаря + состояние галочки маркировки.
 */
export interface TnvedCheckItem {
    offer: string; // конкретная карточка на маркетплейсе (offer_id / vendorCode, может быть суффиксной)
    goodscode: string;
    name?: string;
    current: string | null; // ТН ВЭД, который стоит на карточке сейчас
    base: string; // наш ТН ВЭД из базы
    markRequired: boolean;
    ok: boolean; // карточка уже в целевом состоянии
    ambiguousReason?: string; // карточку нельзя ни принять, ни поправить автоматически — руками
    reason?: string; // почему требует правки (когда !ok и нет ambiguousReason)
    action?: string; // что будет записано
}

/** Итог чтения: решения по карточкам + товары базы, у которых на маркетплейсе нет ни одной карточки. */
export interface TnvedCheckResult {
    items: TnvedCheckItem[];
    notFound: string[]; // goodscode
}

/** Итог записи одной карточки. */
export interface TnvedUpdateResult {
    offer: string;
    taskId?: number;
    error?: string;
}

export interface ITnvedUpdateable {
    /** Сверить карточки маркетплейса с нашей базой. Ничего не пишет. */
    checkTnved(base: TnvedBaseItem[]): Promise<TnvedCheckResult>;

    /** Записать целевое состояние на карточки из своего же checkTnved (те, что !ok и без ambiguousReason). */
    updateTnved(items: TnvedCheckItem[]): Promise<TnvedUpdateResult[]>;
}
