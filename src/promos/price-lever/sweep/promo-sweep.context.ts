import { IJobContext } from '../../../interfaces/i.job.context';
import { PromoPriceApplyResult, PromoPricePlan, PromoPriceState, PromoSweepReport } from '../promo-price.types';

/** Вид фоновой задачи в JobService. */
export const PROMO_SWEEP_JOB = 'ozon-promo-below-min';

/** Контекст сверки «ниже минимума»: состояние → план → (применение) → отчёт. */
export interface IPromoSweepContext extends IJobContext {
    apply: boolean;
    /** Все товары в акциях. */
    checked?: number;
    /** Только те, у кого цена покупателю ниже min_price. */
    states?: PromoPriceState[];
    plans?: PromoPricePlan[];
    results?: PromoPriceApplyResult[];
    report?: PromoSweepReport;
}
