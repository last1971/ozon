import { IJobContext } from '../../../interfaces/i.job.context';
import { PromoPriceApplyResult, PromoPricePlan, PromoPriceState, PromoSweepReport } from '../promo-price.types';
import { SweepGoalKind } from './sweep-goal';

/** Вид фоновой задачи в JobService. */
export const PROMO_SWEEP_JOB = 'ozon-promo-sweep';

/** Контекст сверки акций: цель → состояние → план → (применение) → отчёт. */
export interface IPromoSweepContext extends IJobContext {
    apply: boolean;
    goal: SweepGoalKind;
    /** Все товары в акциях. */
    checked?: number;
    /** Только те, кого берёт цель. */
    states?: PromoPriceState[];
    plans?: PromoPricePlan[];
    results?: PromoPriceApplyResult[];
    report?: PromoSweepReport;
}
