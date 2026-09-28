import { TnvedBaseItem, TnvedCheckItem } from './i.tnved.updateable';
import { CardSyncOptions, CardSyncReport, ICardSyncContext, SyncFixItem } from './i.card.sync';

/** ТН ВЭД — режим общей сверки карточек: типы режима поверх общих (i.card.sync.ts). */
export type TnvedSyncOptions = CardSyncOptions;
export type TnvedFixItem = SyncFixItem<TnvedCheckItem>;
export type TnvedSyncReport = CardSyncReport<TnvedCheckItem>;
export type ITnvedProcessingContext = ICardSyncContext<TnvedBaseItem, TnvedCheckItem>;

/** Имя набора в ProcessedCacheService: ключ processed:tnved:<market>, значения — goodscode. */
export const TNVED_PROGRESS_CACHE = 'tnved';
