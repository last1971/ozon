import { JobProgress } from './i.job.context';
import { ICardSyncable, SyncBaseItem, SyncCheckItem, SyncCheckResult, SyncUpdateResult } from './i.card.sync';

/**
 * Договор маркетплейса по ТН ВЭД — режим общей сверки карточек (i.card.sync.ts): прочитать, что стоит
 * на карточках, и записать наш код. Словари, атрибуты, характеристики и прочие особенности маркетплейса
 * живут внутри реализации.
 */

/** Строка нашей базы: товар + его ТН ВЭД + маркируемость. Источник истины. */
export interface TnvedBaseItem extends SyncBaseItem {
    tnved: string;
    markRequired: boolean;
}

/**
 * Решение маркетплейса по одной карточке. Маркетплейс сам решает, «ок» ли карточка:
 * у Озона это не совпадение цифр, а нужный вариант словаря + состояние галочки маркировки.
 * current — ТН ВЭД на карточке, base — наш ТН ВЭД.
 */
export interface TnvedCheckItem extends SyncCheckItem {
    markRequired: boolean;
}

/** Итог чтения: решения по карточкам + товары базы, у которых на маркетплейсе нет ни одной карточки. */
export type TnvedCheckResult = SyncCheckResult<TnvedCheckItem>;

/** Карточка маркетплейса как она есть: артикул, наш код товара (числовой префикс артикула), название. */
export interface TnvedMarketOffer {
    offer: string;
    goodscode: string;
    name?: string;
}

/** Итог записи одной карточки. */
export type TnvedUpdateResult = SyncUpdateResult;

export interface ITnvedUpdateable extends ICardSyncable<TnvedBaseItem, TnvedCheckItem> {
    /** Все карточки маркетплейса (для «где у нас пусто»). Фаза «каталог». */
    listOffers(progress?: JobProgress): Promise<TnvedMarketOffer[]>;
}
