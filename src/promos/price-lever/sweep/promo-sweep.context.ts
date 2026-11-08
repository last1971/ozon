import { PricingSnapshot } from '../../../helpers/price/price-update.queue';
import { IJobContext } from '../../../interfaces/i.job.context';
import { PromoPriceApplyResult, PromoPricePlan, PromoPriceState, PromoSweepReport } from '../promo-price.types';
import { SweepGoalKind } from './sweep-goal';

/** Вид фоновой задачи в JobService. */
export const PROMO_SWEEP_JOB = 'ozon-promo-sweep';

/** Контекст сверки акций: цель → состояние → план → (применение) → отчёт. */
export interface IPromoSweepContext extends IJobContext {
    offerIds?: string[];
    assertInputsCurrent?: (offerId: string) => Promise<void>;
    apply: boolean;
    goal: SweepGoalKind;
    /** Все товары кабинета. */
    checked?: number;
    /** Только те, кого берёт цель. */
    states?: PromoPriceState[];
    /** Полный снимок до предварительного отбора по старой цене API. */
    collectedStates?: PromoPriceState[];
    /** Ошибки расчёта: показать в отчёте, не применять план по старому минимуму. */
    pricingErrors?: Map<string, string>;
    pricingSnapshots?: Map<string, PricingSnapshot>;
    plans?: PromoPricePlan[];
    results?: PromoPriceApplyResult[];
    report?: PromoSweepReport;
}
