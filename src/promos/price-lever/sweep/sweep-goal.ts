import { planPromoPrice, targetRubles } from '../promo-price.planner';
import { PromoPricePlan, PromoPriceState } from '../promo-price.types';

/** Цель сверки акций: что ищем и к чему приводим. */
export type SweepGoalKind = 'below-min' | 'min' | 'normal';
export const SWEEP_GOAL_KINDS: SweepGoalKind[] = ['below-min', 'min', 'normal'];

/** Расхождение с целью меньше рубля — округление Ozon, не повод менять акции. */
const TOLERANCE_RUB = 1;

/**
 * Единственное место, где решается, какие товары берёт сверка и каким планом их лечит.
 * Команды цепочки цель не толкуют — спрашивают её.
 */
export interface SweepGoal {
    readonly kind: SweepGoalKind;
    readonly title: string;
    selects(s: PromoPriceState): boolean;
    plan(s: PromoPriceState): PromoPricePlan;
}

const priced = (s: PromoPriceState) => s.minPrice > 0 && s.buyerPrice > 0;

/** Решение 19.10: только ниже min_price; наш процент — ровно минимум акции, цель min. */
const belowMin: SweepGoal = {
    kind: 'below-min',
    title: 'ниже минимальной',
    selects: (s) => priced(s) && s.buyerPrice < s.minPrice,
    plan: (s) => planPromoPrice(s, 'min', s.seller?.minPercent),
};

/** Решение 20.10: цена покупателю ≠ цели в обе стороны; процент подбирает планировщик. */
const toTarget = (target: 'min' | 'normal', title: string): SweepGoal => ({
    kind: target,
    title,
    selects: (s) => priced(s) && Math.abs(s.buyerPrice - targetRubles(s, target)) > TOLERANCE_RUB,
    plan: (s) => planPromoPrice(s, target),
});

const GOALS: Record<SweepGoalKind, SweepGoal> = {
    'below-min': belowMin,
    min: toTarget('min', 'привести к минимальной'),
    normal: toTarget('normal', 'привести к нормальной'),
};

export const sweepGoal = (kind: SweepGoalKind): SweepGoal => GOALS[kind];
