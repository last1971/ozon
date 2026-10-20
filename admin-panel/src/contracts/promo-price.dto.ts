/** Зеркало src/promos/price-lever/promo-price.types.ts на бэке (ручки /api/promos/ozon/price-*, promo-sweep). */

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
    steps: PromoPriceStep[];
    notes: string[];
    /** Только при применении. */
    results?: PromoStepResult[];
    applied?: boolean;
}

/** Итог сверки: сколько товаров ниже минимума и чем их лечит план. */
/** Цель сверки акций (src/promos/price-lever/sweep/sweep-goal.ts на бэке). */
export type SweepGoalKind = 'below-min' | 'min' | 'normal';
export const SWEEP_GOALS: { value: SweepGoalKind; title: string; hint: string }[] = [
    {
        value: 'below-min',
        title: 'Ниже минимальной',
        hint: 'Товары в акциях, у которых цена покупателю ниже минимальной. План: наш процент — минимум акции, ' +
            'акции Ozon остаются, если их лимит держит минимальную, иначе товар из них выкидывается.',
    },
    {
        value: 'min',
        title: 'Привести к минимальной',
        hint: 'Товары в акциях, у которых цена покупателю не равна минимальной — дороже или дешевле. План ведёт к ' +
            'минимальной в обе стороны: наш процент и цены в акциях Ozon, ниже минимальной не опускает.',
    },
    {
        value: 'normal',
        title: 'Привести к нормальной',
        hint: 'Товары в акциях, у которых цена покупателю не равна нормальной. План ведёт к нормальной: ' +
            'наш процент — не меньше минимума акции, акции Ozon — по цене под цель.',
    },
];

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
    /** Ниже минимума, но шагов нет (формула расходится с Ozon) — смотреть руками. */
    nothingToDo: number;
    /** При применении: товаров, где не все шаги прошли. */
    failed: number;
    items: PromoSweepItem[];
}
