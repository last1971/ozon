/**
 * Заказ Яндекс Маркета (GET campaigns/{id}/orders/{orderId} → `order`, а также
 * элементы `orders[]` списка). Только поля, которые читаем.
 */
export type YandexInstanceType = 'CIS' | 'CIS_OPTIONAL' | 'UIN' | 'RNPT' | 'GTD';

export interface YandexOrderItemInstanceDto {
    cis?: string;
    cisFull?: string;
    uin?: string;
    rnpt?: string;
    gtd?: string;
}

export interface YandexOrderItemDto {
    /** Идентификатор позиции В ЗАКАЗЕ — по нему передаются коды маркировки. */
    id: number;
    offerId: string;
    count: number;
    priceBeforeDiscount?: number;
    /** Какие идентификаторы Яндекс ждёт по позиции (CIS — обязателен, CIS_OPTIONAL — пока нет). */
    requiredInstanceTypes?: YandexInstanceType[];
    /** Уже переданные коды. */
    instances?: YandexOrderItemInstanceDto[];
}

export interface YandexOrderDto {
    id: number;
    status: string;
    substatus?: string;
    creationDate: string;
    updatedAt?: string;
    items: YandexOrderItemDto[];
}

/** Тело PUT campaigns/{id}/orders/{orderId}/boxes — раскладка по коробкам с кодами. */
export interface YandexBoxLayoutRequestDto {
    boxes: {
        items: {
            id: number;
            fullCount: number;
            instances?: { cis: string }[];
        }[];
    }[];
}
