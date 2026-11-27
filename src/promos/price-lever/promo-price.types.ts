import type { UpdatePriceDto } from '../../price/dto/update.price.dto';
import type { SweepGoalKind } from './sweep/sweep-goal';
/**
 * Цена товара на Ozon с 12.10.2026: одна предельная цена (price), акции Ozon её не снижают, товар попадает
 * в акцию сам, если price ≤ порога. Покупатель = price × (1 − процент нашей акции). min_price («Ограничение
 * для акций и стратегий») хранит нашу минимальную. Доменные типы без полей Seller API.
 */

/** Участие (или кандидатство) товара в одной Ozon-акции. */
export interface OzonActionSlot {
    actionId: number;
    title: string;
    isVoucher: boolean;
    /** true — участник, false — кандидат. */
    participant: boolean;
    /** Текущая цена в акции (у кандидата 0). */
    actionPrice: number;
    /** Порог акции: товар участвует, пока предельная цена не выше. */
    maxActionPrice: number;
    stock: number;
    /** Начало акции (date_start из /v1/actions); null — неизвестно, считаем идущей. */
    startsAt: string | null;
}

/** Товар в нашей seller-акции; null в состоянии — товар туда не годится или акции нет. */
export interface SellerSlot {
    actionId: number;
    title: string;
    /** min_action_percent текущей акции — ниже Ozon не принимает. */
    minPercent: number;
    /** Акция включена в кабинете: только тогда процент снижает цену покупателю. */
    actionOn: boolean;
    sku: number;
    /** Текущий процент (у кандидата — предложенный Ozon, не действующий). */
    percent: number;
    /** true — участник, false — кандидат. */
    isActive: boolean;
}

export interface PromoPriceState {
    offerId: string;
    productId: number;
    autoActionEnabled?: boolean;
    oldPrice: number;
    price: number;
    minPrice: number;
    /** Цена покупателю по данным Ozon (marketing_seller_price). */
    buyerPrice: number;
    /** Та же цена по нашей формуле — расхождение с buyerPrice значит, что формула чего-то не знает. */
    buyerPriceCalc: number;
    seller: SellerSlot | null;
    /** Участие в акциях Ozon — только для просмотра, цену не меняет. */
    ozonActions: OzonActionSlot[];
}

/** Импорт цены: предельная, ограничение (наша минимальная), зачёркнутая. */
export type BaseStep = { kind: 'base'; target: UpdatePriceDto };
/** Процент нашей акции: только вниз, до минимального процента акции. */
export type PercentStep = { kind: 'percent'; actionId: number; sku: number; from: number; to: number };
export type PromoPriceStep = BaseStep | PercentStep;

export interface PromoPricePlan {
    offerId: string;
    productId: number;
    /** Наша минимальная: покупатель платит не меньше. */
    target: number;
    /** Процент нашей акции, по которому посчитана предельная цена (0 — товар не в ней). */
    percent: number;
    /** Предельная цена после плана. */
    price: number;
    steps: PromoPriceStep[];
    buyerBefore: number;
    buyerAfter: number;
    /** Итог не ниже минимальной. */
    ok: boolean;
    notes: string[];
    state: PromoPriceState;
}

/** Итог одного шага применения. skipped — не выполняли намеренно (см. reason). */
export interface PromoStepResult {
    step: PromoPriceStep;
    status: 'ok' | 'rejected' | 'skipped';
    reason?: string;
    /** true — Ozon подтвердил реальное изменение; false — «уже стоит», фактически ничего не менялось. */
    changed?: boolean;
}

export interface PromoReadback {
    /** Итог повторного чтения цены и участия в акциях после отправки шагов. */
    verification?: 'confirmed' | 'unchanged' | 'pending';
    observedBuyerPrice?: number;
}

/** План, который применили: шаги в порядке выполнения с итогом каждого. */
export interface PromoPriceApplyResult extends PromoPricePlan, PromoReadback {
    results: PromoStepResult[];
    /** Все шаги прошли. */
    applied: boolean;
    /** true — хотя бы один запрос к Ozon начат (даже если завершился ошибкой). */
    attempted?: boolean;
    /** true — план отклонён из-за устаревших данных до начала отправки (PricePlanStaleError). */
    stale?: boolean;
}

/** Товар в отчёте сверки «ниже минимума»: план без полного состояния (отчёт на сотни строк). */
export interface PromoSweepItem extends PromoReadback {
    offerId: string;
    productId: number;
    price: number;
    minPrice: number;
    /** Наша минимальная. */
    target: number;
    buyerBefore: number;
    buyerAfter: number;
    ok: boolean;
    steps: PromoPriceStep[];
    notes: string[];
    /** Только при применении. */
    results?: PromoStepResult[];
    applied?: boolean;
}

/** Итог сверки: сколько товаров отобрала цель и чем их лечит план. */
export interface PromoSweepReport {
    apply: boolean;
    goal: SweepGoalKind;
    /** Товаров в акциях, проверено. */
    checked: number;
    /** Отобрано целью. */
    selected: number;
    /** Меняется предельная цена, ограничение или зачёркнутая. */
    priceChanged: number;
    /** Меняется процент нашей акции. */
    percentChanged: number;
    /** Нет минимальной в Ozon или формула не объясняет цену покупателю — смотреть руками. */
    unfixable: number;
    /** При применении: товаров, где не все шаги прошли. */
    failed: number;
    pendingConfirmation?: number;
    items: PromoSweepItem[];
}
