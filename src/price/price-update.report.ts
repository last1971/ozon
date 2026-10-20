import { GoodServiceEnum } from '../good/good.service.enum';
import { IPriceable } from '../interfaces/i.priceable';
import { UpdatePriceDto } from './dto/update.price.dto';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';

/**
 * Почему артикулу не считали цену.
 * - `no-free-stock` — товар на складе есть, но свободного нет (всё в резерве или распродано): входная 0 законно,
 *   продавать нечего, ждать бесполезно.
 * - `not-in-stock` — товара нет в складской таблице совсем: приход ещё не дошёл до остатка, цену посчитать не из чего.
 */
export type PriceSkipReason = 'no-free-stock' | 'not-in-stock';

export interface PriceSkip {
    offer_id: string;
    reason: PriceSkipReason;
}

/** Итог пересчёта цен одной площадки: из чего считали, что отправили, что ответила площадка, кого пропустили. */
export interface PriceUpdateReport {
    /** Коэффициенты площадки (эквайринг, логистика, налог…) — общие для всех артикулов расчёта. */
    coeffs?: ObtainCoeffsDto;
    inputs: IPriceable[];
    sent: UpdatePriceDto[];
    skipped: PriceSkip[];
    /** Ответ площадки как есть; null — отправлять было нечего. */
    response: any;
}

export interface ServicePriceReport extends PriceUpdateReport {
    service: GoodServiceEnum;
}

/** Строка ответа Озона на /v1/product/import/prices. */
export interface OzonPriceResult {
    offer_id: string;
    product_id?: number;
    updated: boolean;
    errors?: { code?: string; message?: string }[];
}

/** Ответ Озона по артикулам; у других площадок формат свой — пустая карта. */
export function ozonResultsByOffer(response: any): Map<string, OzonPriceResult> {
    const rows: OzonPriceResult[] = Array.isArray(response?.result) ? response.result : [];
    return new Map(rows.filter((r) => r?.offer_id).map((r) => [String(r.offer_id), r]));
}

/** Ответ Озона по одному артикулу словами: «принят» или «отказ: код текст». */
export function describeOzonResult(result: OzonPriceResult | undefined): string {
    if (!result) return 'нет в ответе';
    const errors = (result.errors || []).map((e) => [e.code, e.message].filter(Boolean).join(' ')).join('; ');
    return result.updated ? (errors ? `принят (${errors})` : 'принят') : `отказ: ${errors || 'без причины'}`;
}
