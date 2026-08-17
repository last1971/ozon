import { WbClaimDto } from '../wb.customer/dto/wb.claim.dto';

/**
 * Нормализация статусов ВБ в словарь конвейера — ЕДИНСТВЕННАЯ точка истины.
 * Литералы статусов ВБ вне этого файла запрещены.
 *
 * `wbStatus` (статус у ВБ): waiting → sorted → ready_for_pickup → sold, либо
 * canceled / canceled_by_client / declined_by_client / defect. Терминальный,
 * истории не хранит. `supplierStatus` (наш статус): new → confirm → complete →
 * cancel; `complete` ставим мы при передаче в доставку, отмену переживает —
 * единственный признак отгрузки у терминального `canceled`.
 */

/** Статусы ВБ, означающие отмену заказа. */
export const WB_CANCEL_STATUSES = ['canceled', 'canceled_by_client', 'declined_by_client', 'defect'] as const;

/** wbStatus → состояние события журнала ('delivered' | 'cancelled' | сырой статус). */
export function wbEventState(wbStatus: string): string {
    if (wbStatus === 'sold') return 'delivered';
    if ((WB_CANCEL_STATUSES as readonly string[]).includes(wbStatus)) return 'cancelled';
    return wbStatus;
}

/**
 * Признак «товар передан в доставку» — для PostingDto.shipped.
 *
 * ТОЛЬКО `supplierStatus === 'complete'`: это наш собственный статус передачи
 * в доставку, и отказ при вручении им уже покрыт (раз вручали — мы отгружали).
 * Отказные wbStatus сюда НЕ входят: `declined_by_client` бывает и отменой
 * в первый час после заказа — собранная, но не отгруженная посылка ушла бы
 * в доноры «склада ВБ», лёжа у нас на полке (фантомный остаток).
 */
export function wbShipped(supplierStatus: string): boolean {
    return supplierStatus === 'complete';
}

/**
 * Заявка на возврат (claim) → озоновский словарь состояний возврата
 * (`mp-decision.types.ts`): решающая таблица сравнивает эти литералы.
 *
 * `status_ex` (статус товара): 0 — на рассмотрении, 1 — у покупателя (отклонена),
 * 2 — в утиль, 5 — у покупателя (одобрена), 8 — возврат в реализацию (товар
 * остаётся у ВБ и продаётся заново — аналог ReturnedToOzon: unretire + донор),
 * 10 — возврат продавцу (едет к нам; терминальность заявки = архив).
 *
 * @returns null — заявка ещё на рассмотрении, события не порождаем (физики нет,
 *          решение появится сменой status_ex и придёт новым состоянием).
 */
export function wbClaimState(claim: WbClaimDto, isArchive: boolean): string | null {
    switch (claim.status_ex) {
        case 0:
            return null;
        case 1:
        case 5:
            // Товар остаётся у покупателя — физики возврата нет, заявочный класс.
            return 'Rejected';
        case 2:
            // В утиль — товар до нас не доедет (класс LOST).
            return 'Utilized';
        case 8:
            // Возврат в реализацию: товар остаётся на складе ВБ — как ReturnedToOzon
            // (код возвращается в оборот, счёт уходит в доноры WBFBO-пула).
            return 'ReturnedToOzon';
        case 10:
            // Возврат продавцу: активная заявка — товар едет, архивная — ВБ закрыл
            // заявку, считаем товар доехавшим (письмо кладовщику «принять» и так ручное).
            return isArchive ? 'ReceivedBySeller' : 'MovingToSeller';
        default:
            return 'unknown';
    }
}
