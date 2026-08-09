/**
 * Константы для отмены заказов Ozon
 */
export const OZON_ORDER_CANCELLATION_SUFFIX = {
    /** Отмена обычного заказа */
    REGULAR: ' отмена',
    /** Отмена заказа FBO (Fulfillment by Ozon) */
    FBO: ' отмена FBO',
} as const;

/** Пометка оплаченного и закрытого счёта: updateByCommissions дописывает её к PRIM. */
export const OZON_INVOICE_CLOSED_SUFFIX = ' закрыт';
