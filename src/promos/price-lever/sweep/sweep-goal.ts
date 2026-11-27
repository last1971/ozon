import { PromoPricePlan } from '../promo-price.types';

/** Цель сверки: 'below-min' — только показать, кто продаётся ниже минимальной; 'min' — всех, чья цена не по правилу. */
export type SweepGoalKind = 'below-min' | 'min';
export const SWEEP_GOAL_KINDS: SweepGoalKind[] = ['below-min', 'min'];

export interface SweepGoal {
    readonly kind: SweepGoalKind;
    readonly title: string;
    selects(plan: PromoPricePlan): boolean;
}

const belowMin = (p: PromoPricePlan) => p.state.buyerPrice > 0 && p.target > 0 && p.state.buyerPrice < p.target;

const GOALS: Record<SweepGoalKind, SweepGoal> = {
    'below-min': { kind: 'below-min', title: 'ниже минимальной', selects: belowMin },
    min: { kind: 'min', title: 'привести к минимальной', selects: (p) => p.steps.length > 0 || belowMin(p) },
};

export const sweepGoal = (kind: SweepGoalKind): SweepGoal => GOALS[kind];
