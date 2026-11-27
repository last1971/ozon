import { PricingSnapshot } from '../../../helpers/price/price-update.queue';
import { IJobContext } from '../../../interfaces/i.job.context';
import { PromoPriceApplyResult, PromoPricePlan, PromoSweepReport } from '../promo-price.types';
import { SweepGoalKind } from './sweep-goal';

/** Вид фоновой задачи в JobService. */
export const PROMO_SWEEP_JOB = 'ozon-promo-sweep';

/** Контекст сверки цен Ozon: каталог → план по правилу → (применение) → отчёт. */
export interface IPromoSweepContext extends IJobContext {
    offerIds?: string[];
    assertInputsCurrent?: (offerId: string) => Promise<void>;
    apply: boolean;
    goal: SweepGoalKind;
    /** Товаров проверено. */
    checked?: number;
    /** Планы отобранных целью товаров. */
    plans?: PromoPricePlan[];
    pricingSnapshots?: Map<string, PricingSnapshot>;
    results?: PromoPriceApplyResult[];
    report?: PromoSweepReport;
}
