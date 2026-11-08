import { FirebirdTransaction } from 'ts-firebird';
import { MpService } from '../../mp-event/mp-event.service';
import { IPriceable } from '../../interfaces/i.priceable';
import { ObtainCoeffsDto } from '../../helpers/dto/obtain.coeffs.dto';

/**
 * Откуда брать НАШУ цену продажи по заказу:
 *  posting — она уже в заказе (Озон: price = наша цена со всеми нашими скидками);
 *  lookup  — в заказе цена покупателя, нашу надо искать отдельно (ВБ: статистика заказов по rid);
 *  none    — площадка нашу цену не отдаёт, проверка не применима.
 */
export type SalePriceSource = 'posting' | 'lookup' | 'none';

/** Строка продажи в единицах маркетплейса (артикул с суффиксом фасовки). */
export interface SaleLine {
    offer_id: string;
    units: number;
    /** Наша цена за единицу маркетплейса. */
    pricePerUnit: number;
    /** В финансовых данных этой строки Ozon подтвердил персональную скидку «Хочу скидку». */
    wannaDiscount?: boolean;
}

/** Ссылка для поиска цены у площадки. */
export interface SalePriceRef {
    posting: string;
    /** Идентификатор в статистике площадки (ВБ: rid заказа = srid статистики). */
    externalId: string;
    since: Date;
}

/** Ссылка для запасного поиска: заказ и его строки (артикулы и количество из заказа). */
export interface SaleFallbackRef {
    externalId: string;
    lines: SaleLine[];
}

/**
 * Откуда в итоге взята наша цена: lookup — основной поиск (точная цена на момент заказа);
 * card — запасной: карточка площадки на момент проверки (основной заказ не отдал).
 */
export type SalePriceOrigin = 'lookup' | 'card';

/** Что кладём в журнал при создании счёта — всё, что нужно проверке, без повторных походов в базу. */
export interface ProfitCheckPayload {
    service: MpService;
    buyerId: number;
    scode: number;
    invoiceNumber: number | null;
    externalId: string;
    priceSource: SalePriceSource;
    /** При priceSource=posting — наши цены; при lookup — цены покупателя, заменяются на найденные. */
    lines: SaleLine[];
    /** Для lookup: откуда взята найденная цена (ставит шаг поиска). */
    priceOrigin?: SalePriceOrigin;
    /** Диагностика существующего повтора в MP_EVENT, исходные цены не заменяются. */
    check?: { completedLineKeys: string[]; retryReason?: string };
}

export type ProfitLevel = 'ok' | 'warn' | 'alert' | 'skip';

export interface LineVerdict extends SaleLine {
    level: ProfitLevel;
    /** Минимальная цена за единицу по минимальной наценке; null — посчитать нельзя. */
    minPrice: number | null;
    profitPerUnit: number | null;
    profitTotal: number | null;
    /** Себестоимость за единицу и откуда она. */
    cost: number | null;
    costSource: 'приход' | 'доступная цена' | null;
    reason?: string;
    retryable?: boolean;
    failureKind?: 'missing-base' | 'invalid-data' | 'temporary';
    profitPercent?: number;
}

export interface ProfitCheckItem {
    posting: string;
    firstSeen: Date;
    payload: ProfitCheckPayload;
    /** ResolveSalePrices: наши цены получены, можно считать. */
    resolved: boolean;
    /** Исходная запись до подстановки найденной цены продавца. */
    originalPayload?: ProfitCheckPayload;
    completedLineKeys?: string[];
    retryReason?: string;
    /** ResolveSalePrices: цены или данных пока нет, оставить в очереди до следующего прохода. */
    deferred: boolean;
    /** ResolveSalePrices: основной поиск не дал цену за lookupHours — дальше запасной источник. */
    expired?: boolean;
    verdicts?: LineVerdict[];
    level?: ProfitLevel;
    reason?: string;
}

/** Данные расчёта цены по артикулу — те же, что кормят пересчёт цен. */
export interface PriceContext {
    priceables: Map<string, IPriceable>;
    coeffs?: ObtainCoeffsDto;
    issues?: Map<string, { reason: string; kind: NonNullable<LineVerdict['failureKind']> }>;
}

export interface ProfitCheckContext {
    warnPercent: number;
    /** Сколько часов ждём появление цены до перехода к запасному источнику. Ошибки API не считаются отсутствием цены. */
    lookupHours: number;
    items: ProfitCheckItem[];
    /** LoadPriceContext: по площадке. */
    priceContexts?: Map<MpService, PriceContext | null>;
    t?: FirebirdTransaction;
    stopChain?: boolean;
}
