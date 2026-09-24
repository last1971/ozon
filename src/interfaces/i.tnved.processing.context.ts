import { GoodServiceEnum } from '../good/good.service.enum';
import { ITnvedUpdateable, TnvedBaseItem, TnvedCheckItem } from './i.tnved.updateable';

export interface TnvedSyncOptions {
    market: GoodServiceEnum; // маркетплейс, обязателен: значение по умолчанию скрывало бы, куда идёт прогон
    apply?: boolean; // false = dry-run (только отчёт), true = писать на маркетплейс
    offer?: string; // ограничить одним GOODSCODE (обкатка) — берутся все его варианты
    limit?: number; // ограничить количество товаров базы (при onlyNew — следующие N необработанных)
    onlyNew?: boolean; // пропустить товары, уже помеченные обработанными (прогресс раскатки в Redis)
}

export interface TnvedFixItem extends TnvedCheckItem {
    taskId?: number; // после apply
    error?: string; // после apply
}

export interface TnvedSyncReport {
    apply: boolean;
    checkedGoods: number; // товаров из базы
    checkedOffers: number; // карточек на маркетплейсе (с учётом суффиксных вариантов)
    toFix: TnvedFixItem[];
    alreadyOk: number;
    notFoundOnOzon: string[]; // goodscode, у которых на маркетплейсе нет ни одной карточки
    ambiguous: { offer: string; reason: string }[];
    skippedProcessed: number; // товаров базы пропущено как уже обработанные (onlyNew)
    remaining: number; // товаров базы ещё не обработано после этого прогона
}

/** Имя набора в ProcessedCacheService: ключ processed:tnved:<market>, значения — goodscode. */
export const TNVED_PROGRESS_CACHE = 'tnved';

/**
 * Контекст сверки ТН ВЭД через паттерн команда (как IVatProcessingContext).
 * Команды заполняют его по очереди: база → фильтр обработанных → сверка → отчёт → запись → отметки.
 */
export interface ITnvedProcessingContext {
    /** Маркетплейс как реализация договора — резолвится сервисом до цепочки, как в НДС */
    service: ITnvedUpdateable;
    opts: TnvedSyncOptions;

    /** Все товары базы с ТН ВЭД (с учётом opts.offer) */
    all?: TnvedBaseItem[];
    /** Уже обработанные goodscode из ProcessedCacheService */
    processed?: Set<string>;
    /** Товары этого прогона: all минус processed (при onlyNew), обрезанные limit */
    base?: TnvedBaseItem[];
    /** Сколько товаров базы пропущено как обработанные */
    skippedProcessed?: number;

    /** Решения маркетплейса по карточкам и товары без карточек */
    items?: TnvedCheckItem[];
    notFound?: string[];

    report?: TnvedSyncReport;

    stopChain?: boolean;
    logger?: { log: (msg: string) => void; error: (msg: string) => void };
}
