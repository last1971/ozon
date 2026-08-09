/**
 * Начисления Ozon: /v1/finance/accrual/*.
 * Замена /v3/finance/transaction/list, которую Ozon отключает 08.09.2026.
 * Источник истины по выплате за период — by-day: сумма начислений за даты
 * недельного периода совпадает с «Оплатой реализации» в кабинете.
 */

/** Категория начисления: к чему оно относится. */
export enum AccrualCategory {
    /** Продажа: unit_number = номер отправления, total_amount = нетто по нему. */
    POSTING = 'POSTING',
    /** Списание по товару (эквайринг, упаковка): unit_number = отправление или заказ. */
    ITEM = 'ITEM',
    /** Прочее (реклама, продвижение бренда): unit_number обычно пуст. */
    NON_ITEM = 'NON_ITEM',
}

export class AccrualAmountDto {
    amount: string;
    currency: string;
}

export class AccrualPostingProductDto {
    sku?: number;
    /** Услуги доставки: уже вычтены из total_amount, это расшифровка. */
    delivery?: unknown;
    /** Расчёт продажи (seller_price, commission). Есть только у «тела». */
    commission?: unknown;
}

export class AccrualPostingDto {
    delivery_schema?: string;
    products?: AccrualPostingProductDto[];
}

export class AccrualDto {
    accrual_id: number;
    date: string;
    total_amount: AccrualAmountDto;
    /** Полный номер отправления, номер заказа без суффикса либо пусто. */
    unit_number: string;
    accrued_category: AccrualCategory | string;
    posting?: AccrualPostingDto;
    item_fees?: unknown;
    non_item_fee?: unknown;
    container_fees?: unknown;
}

export class AccrualByDayResultDto {
    accruals: AccrualDto[];
    /** Курсор постраничного чтения внутри одного дня. */
    last_id?: number;
}

export class PayoutPeriodDto {
    period: { id: number; begin: string; end: string };
    orders_amount: number;
    returns_amount: number;
    commission_amount: number;
    services_amount: number;
    item_delivery_and_return_amount: number;
    currency_code: string;
}
