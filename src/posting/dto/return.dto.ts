export class ReturnDto {
    /** Ozon — числовой id возврата, ВБ — UUID заявки. В журнал уходит строкой. */
    id: number | string;
    posting_number: string;
    schema: 'Fbs' | 'Fbo';
    order_number: string;
    /** Ozon: 'Cancellation' — отменённый заказ, 'ClientReturn' — возврат после выкупа. */
    type?: string;
    logistic?: {
        return_date?: string;
    };
    /**
     * Откуда и куда едет коробка. Единственный НАДЁЖНЫЙ признак направления:
     * имя состояния его не даёт — `WaitingShipment` встречается на пути и к Ozon
     * (`… → ПЕРМЬ_РФЦ_ВОЗВРАТЫ`), и к нам (`… → ТОМСК_70`, живые случаи
     * `04808040-0413-1` и `24497386-0470-1` от 24–25.08.2026). В решениях не
     * используется — идёт в письмо, чтобы человек видел маршрут глазами.
     */
    place?: { id?: number; name?: string };
    target_place?: { id?: number; name?: string };
    visual?: {
        status?: {
            id: number;
            sys_name: string;
            display_name: string;
        };
    };
}
