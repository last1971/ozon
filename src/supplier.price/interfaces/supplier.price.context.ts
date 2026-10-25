import { Logger } from '@nestjs/common';
import { SupplierPriceItemDto } from '../dto/supplier.price.request.dto';
import { SupplierPriceErrorDto, SupplierPriceResultDto } from '../dto/supplier.price.response.dto';

/** Одна строка в работе: что пришло + что уже посчитано кирпичами. Ошибка строки — в `error`, дальше её не считают. */
export interface SupplierPriceWorkItem {
    input: SupplierPriceItemDto;
    /** Закупка за штуку в рублях (после кирпича валюты). */
    incomingRub?: number;
    /** Ступени поставщика в рублях за штуку, по тем же курсам. */
    tiersRub?: { quantity: number; priceRub: number }[];
    /** Доставка от поставщика, руб. за штуку (кирпич доставки). */
    deliveryRub?: number;
    result?: SupplierPriceResultDto;
    error?: string;
}

export interface ISupplierPriceContext {
    rates: Record<string, number>;
    items: SupplierPriceWorkItem[];
    prices: SupplierPriceResultDto[];
    errors: SupplierPriceErrorDto[];
    logger?: Logger;
    stopChain?: boolean;
}
