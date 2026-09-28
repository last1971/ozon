import { GoodServiceEnum } from '../good/good.service.enum';
import { IJobContext, JobProgress } from './i.job.context';

/**
 * Общий договор сверки карточек маркетплейса с нашей базой: база — источник истины, маркетплейс
 * читает свои карточки и решает по каждой, по команде пишет. Что именно сверяется (ТН ВЭД, GTIN…) —
 * режим; цепочка команд, фоновая задача, отчёт и прогресс раскатки у всех режимов одни (CardSyncService).
 */

/** Режим сверки: какое поле карточки приводим к базе. */
export enum CardSyncMode {
    TNVED = 'tnved',
    GTIN = 'gtin',
}

/** Строка базы: товар. progressKey — чем отмечать «обработано» (по умолчанию goodscode); без запятых. */
export interface SyncBaseItem {
    goodscode: string;
    progressKey?: string;
}

/** Решение маркетплейса по одной карточке. current/base — строки для показа в отчёте. */
export interface SyncCheckItem {
    offer: string; // карточка на маркетплейсе (offer_id / vendorCode, может быть суффиксной)
    goodscode: string;
    name?: string;
    current: string | null; // что стоит на карточке сейчас
    base: string; // что должно стоять по базе
    ok: boolean; // карточка уже в целевом состоянии
    ambiguousReason?: string; // ни принять, ни поправить автоматически — руками
    reason?: string; // почему требует правки (когда !ok и нет ambiguousReason)
    action?: string; // что будет записано
}

/** Итог чтения: решения по карточкам + товары базы, у которых на маркетплейсе нет ни одной карточки. */
export interface SyncCheckResult<I extends SyncCheckItem = SyncCheckItem> {
    items: I[];
    notFound: string[]; // goodscode
}

/** Итог записи одной карточки. */
export interface SyncUpdateResult {
    offer: string;
    taskId?: number;
    error?: string;
}

export interface ICardSyncable<B extends SyncBaseItem = SyncBaseItem, I extends SyncCheckItem = SyncCheckItem> {
    /** Сверить карточки с базой. Ничего не пишет. Фазы «каталог»/«сверка» и done/total двигает сам маркетплейс. */
    check(base: B[], progress?: JobProgress): Promise<SyncCheckResult<I>>;

    /** Записать целевое состояние на карточки из своего же check (те, что !ok и без ambiguousReason). */
    update(items: I[], progress?: JobProgress): Promise<SyncUpdateResult[]>;
}

export interface CardSyncOptions {
    mode?: CardSyncMode; // по умолчанию ТН ВЭД — как было до режимов
    market: GoodServiceEnum; // маркетплейс, обязателен: значение по умолчанию скрывало бы, куда идёт прогон
    apply?: boolean; // false = dry-run (только отчёт), true = писать на маркетплейс
    offer?: string; // ограничить одним GOODSCODE (обкатка) — берутся все его варианты
    limit?: number; // ограничить количество товаров базы (при onlyNew — следующие N необработанных)
    onlyNew?: boolean; // пропустить товары, уже помеченные обработанными (прогресс раскатки в Redis)
}

export type SyncFixItem<I extends SyncCheckItem = SyncCheckItem> = I & {
    taskId?: number; // после apply
    error?: string; // после apply
};

export interface CardSyncReport<I extends SyncCheckItem = SyncCheckItem> {
    apply: boolean;
    checkedGoods: number; // товаров из базы
    checkedOffers: number; // карточек на маркетплейсе (с учётом суффиксных вариантов)
    toFix: SyncFixItem<I>[];
    alreadyOk: number;
    notFoundOnOzon: string[]; // goodscode без карточки на маркетплейсе (имя историческое — его читает админка)
    ambiguous: { offer: string; reason: string }[];
    skippedProcessed: number; // товаров базы пропущено как уже обработанные (onlyNew)
    remaining: number; // товаров базы ещё не обработано после этого прогона
}

/**
 * Контекст сверки через паттерн команда. Команды заполняют его по очереди:
 * база → фильтр обработанных → сверка → отчёт → запись → отметки. Базу грузит своя команда режима.
 */
export interface ICardSyncContext<
    B extends SyncBaseItem = SyncBaseItem,
    I extends SyncCheckItem = SyncCheckItem,
> extends IJobContext {
    /** Маркетплейс как реализация договора режима — резолвится сервисом до цепочки */
    service: ICardSyncable<B, I>;
    opts: CardSyncOptions;
    /** Имя набора в ProcessedCacheService (processed:<progressCache>:<market>) */
    progressCache: string;

    all?: B[];
    processed?: Set<string>;
    base?: B[];
    skippedProcessed?: number;

    items?: I[];
    notFound?: string[];

    report?: CardSyncReport<I>;
}

/** Ключ отметки «обработано» строки базы. */
export const progressKeyOf = (item: SyncBaseItem): string => item.progressKey ?? item.goodscode;
