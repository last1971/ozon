import { SyncBaseItem, SyncCheckItem } from './i.card.sync';

/**
 * GTIN — режим общей сверки карточек (i.card.sync.ts). Баркод уникален в кабинете площадки, поэтому
 * все GTIN товара из базы стоят в баркодах ровно одной его карточки — «держателя» (кто уже держит, иначе
 * минимальная фасовка). Остальным карточкам товара GTIN тоже обязателен (площадки с 01.10.2026 блокируют
 * маркируемые карточки без него) — он уходит в отдельное поле «дополнительный GTIN» там, где площадка
 * такое поле даёт (ВБ: gtin). Площадка без этого поля (Озон) правит только держателя.
 */

/** Строка базы: товар + все его непустые GTIN (свой и поставщиков). progressKey — товар + набор GTIN. */
export interface GtinBaseItem extends SyncBaseItem {
    gtins: string[];
}

/** Куда писать GTIN на карточке: в баркоды (держатель) или в поле «дополнительный GTIN». */
export type GtinSlot = 'barcodes' | 'extra';

/**
 * Решение по одной карточке. current — что на ней стоит, base — наши GTIN (строки для отчёта).
 * add — чего не хватает (в записи как в базе), slot — куда это писать. marketId — чем площадка адресует
 * карточку при записи (Озон: SKU).
 */
export interface GtinCheckItem extends SyncCheckItem {
    add: string[];
    slot: GtinSlot;
    marketId?: number;
}

/**
 * Карточка площадки глазами режима GTIN: артикул, баркоды, адрес для записи; ambiguousReason — в баркоды
 * писать нельзя. extraSlot — у площадки есть поле «дополнительный GTIN», extraGtin — что в нём стоит.
 */
export interface BarcodeOffer {
    offer: string;
    name?: string;
    barcodes: string[];
    marketId?: number;
    ambiguousReason?: string;
    extraSlot?: boolean;
    extraGtin?: string | null;
}

/** Имя набора в ProcessedCacheService: processed:gtin:<market>, значения — «goodscode:gtin|gtin». */
export const GTIN_PROGRESS_CACHE = 'gtin';
