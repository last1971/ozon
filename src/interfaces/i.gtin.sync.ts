import { SyncBaseItem, SyncCheckItem } from './i.card.sync';

/**
 * GTIN — режим общей сверки карточек (i.card.sync.ts): все GTIN товара из базы должны стоять
 * в баркодах карточки его минимальной фасовки. Остальные фасовки не трогаем (решение владельца).
 */

/** Строка базы: товар + все его непустые GTIN (свой и поставщиков). progressKey — товар + набор GTIN. */
export interface GtinBaseItem extends SyncBaseItem {
    gtins: string[];
}

/**
 * Решение по карточке минимальной фасовки. current — баркоды карточки, base — наши GTIN (строки для отчёта).
 * add — чего не хватает (в записи как в базе). marketId — чем площадка адресует карточку при записи (Озон: SKU).
 */
export interface GtinCheckItem extends SyncCheckItem {
    add: string[];
    marketId?: number;
}

/** Карточка площадки глазами режима GTIN: артикул, баркоды, адрес для записи; ambiguousReason — писать нельзя. */
export interface BarcodeOffer {
    offer: string;
    name?: string;
    barcodes: string[];
    marketId?: number;
    ambiguousReason?: string;
}

/** Имя набора в ProcessedCacheService: processed:gtin:<market>, значения — «goodscode:gtin|gtin». */
export const GTIN_PROGRESS_CACHE = 'gtin';
