import type { SweepGoalKind } from './sweep/sweep-goal';
/**
 * Ручка цены через акции: состояние товара и план (dry-run). Доменные типы без полей Seller API.
 * Цена покупателю = min(цены Ozon-акций, price) × (1 − процент нашей акции) — см. buyer.price.helper.
 */

/** Цель: 'min' — min_price, 'normal' — price, число — своя цена в коридоре [min_price, price]. */
export type PromoTarget = 'min' | 'normal' | number;

/** Участие (или кандидатство) товара в одной Ozon-акции. */
export interface OzonActionSlot {
    actionId: number;
    title: string;
    /** Промокодная: цену не назначить, снять — только deactivate. */
    isVoucher: boolean;
    /** true — участник, false — кандидат. */
    participant: boolean;
    /** Текущая цена в акции (у кандидата 0). */
    actionPrice: number;
    /** Предельная цена: выше — Ozon в акцию не берёт (или исключает). */
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
    sku: number;
    /** Текущий процент (у кандидата — предложенный Ozon, не действующий). */
    percent: number;
    /** true — участник, false — кандидат. */
    isActive: boolean;
}

export interface PromoPriceState {
    offerId: string;
    productId: number;
    oldPrice: number;
    price: number;
    minPrice: number;
    /** Цена покупателю по данным Ozon (marketing_seller_price). */
    buyerPrice: number;
    /** Та же цена по нашей формуле — расхождение с buyerPrice значит, что формула чего-то не знает. */
    buyerPriceCalc: number;
    seller: SellerSlot | null;
    ozonActions: OzonActionSlot[];
}

/** Шаг плана. from = null — товара там ещё нет (добавление). */
export type PromoPriceStep =
    | { kind: 'ozon-set'; actionId: number; title: string; from: number | null; to: number }
    | { kind: 'ozon-remove'; actionId: number; title: string; from: number; reason: string }
    | { kind: 'percent'; actionId: number; sku: number; from: number | null; to: number };

export interface PromoPricePlan {
    offerId: string;
    productId: number;
    /** Цель в рублях после зажатия в коридор. */
    target: number;
    /** Процент нашей акции после плана (0 — товар не в ней). */
    percent: number;
    /** Пол, по которому решались Ozon-акции (с процентом на входе, до подбора процента). */
    floor: number;
    steps: PromoPriceStep[];
    buyerBefore: number;
    buyerAfter: number;
    /** Итог не ниже min_price. */
    ok: boolean;
    /** Шагов нет, а ближе к цели не подойти: следующий шаг рычага (рубль цены в акции Ozon или процент нашей акции) уводит ниже цели. */
    closest: boolean;
    notes: string[];
    state: PromoPriceState;
}

/** Итог одного шага применения. skipped — не выполняли намеренно (см. reason). */
export interface PromoStepResult {
    step: PromoPriceStep;
    status: 'ok' | 'rejected' | 'skipped';
    reason?: string;
}

/** План, который применили: шаги в порядке выполнения с итогом каждого. */
export interface PromoPriceApplyResult extends PromoPricePlan {
    results: PromoStepResult[];
    /** Все шаги прошли. */
    applied: boolean;
}

/** Товар в отчёте сверки «ниже минимума»: план без полного состояния (отчёт на сотни строк). */
export interface PromoSweepItem {
    offerId: string;
    productId: number;
    price: number;
    minPrice: number;
    /** Цель плана в рублях. */
    target: number;
    buyerBefore: number;
    buyerAfter: number;
    ok: boolean;
    /** Шагов нет — ближе к цели не подойти (см. PromoPricePlan.closest). */
    closest: boolean;
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
    /** Ozon-акции остались (цена поднята до пола), из них никого не выкинули. */
    keptInOzon: number;
    /** Хоть из одной Ozon-акции выкинуты. */
    removedFromOzon: number;
    /** Меняется процент нашей акции. */
    percentChanged: number;
    /** План не выводит выше минимума. */
    unfixable: number;
    /** Шагов нет: цена уже ближайшая к цели, следующий шаг уводит ниже. */
    closest: number;
    /** Отобран, но шагов нет и это не «ближе нельзя» (формула расходится с Ozon или акции не дают) — смотреть руками. */
    nothingToDo: number;
    /** При применении: товаров, где не все шаги прошли. */
    failed: number;
    items: PromoSweepItem[];
}
