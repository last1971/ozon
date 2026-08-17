import { MpService } from '../mp-event/mp-event.service';

/**
 * Единый объект суффиксов отмен — ЕДИНСТВЕННАЯ точка записи и распознавания
 * пометок отмены в S.PRIM. Строковые литералы пометок вне этого файла запрещены.
 */
export const MP_ORDER_CANCELLATION_SUFFIX = {
    /** Отмена обычного заказа (товар физически у нас) */
    REGULAR: ' отмена',
    /** Отмена/возврат FBO Ozon: товар остался на складе Ozon → счёт в доноры FBO-пула */
    FBO: ' отмена FBO',
    /**
     * ВБ: отмена после отгрузки (отказник) — товар остаётся на складе ВБ и продаётся
     * оттуда → счёт в доноры. Подстрока «WBFBO» обязана сохраняться: донорский поиск
     * ВБ идёт `PRIM CONTAINING 'WBFBO'` (checkFboWbOrders → prims: ['WBFBO']).
     */
    WBFBO: ' отмена WBFBO',
} as const;

/**
 * Историческая пометка легаси-крона checkCanceledWbOrders (62+ счёта на проде).
 * РАСПОЗНАЁТСЯ как отмена (иначе конвейер отмен пытается обработать уже
 * разобранный счёт и падает на точном поиске PRIM), но новым кодом НЕ ПИШЕТСЯ.
 */
export const LEGACY_CANCELLATION_SUFFIXES: readonly string[] = [' возврат WBFBO'];

/** Все суффиксы, по которым счёт считается отменённым, — для findByPosting.cancelled. */
export const ALL_CANCELLATION_SUFFIXES: readonly string[] = [
    ...Object.values(MP_ORDER_CANCELLATION_SUFFIX),
    ...LEGACY_CANCELLATION_SUFFIXES,
];

/**
 * Донорский суффикс по маркетплейсу события: товар остался на складе маркетплейса,
 * счёт уходит в его донорский пул. Пометить ВБ-счёт озоновским суффиксом (или
 * наоборот) нельзя: донорский SQL не фильтрует по покупателю, и партия с кодом
 * уехали бы на счёт чужого маркетплейса.
 */
export function donorSuffixFor(service: MpService | undefined): string {
    return service === 'WB' ? MP_ORDER_CANCELLATION_SUFFIX.WBFBO : MP_ORDER_CANCELLATION_SUFFIX.FBO;
}

/** Пометка оплаченного и закрытого счёта: updateByCommissions дописывает её к PRIM. */
export const OZON_INVOICE_CLOSED_SUFFIX = ' закрыт';
