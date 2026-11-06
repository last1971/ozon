import { OzonPromosApi } from '../promos.api';
import { planPromoPrice } from './promo-price.planner';
import { PromoPricePlan } from './promo-price.types';

/** Сверить лимиты непосредственно перед применением; решения принимает только общий планировщик. */
export async function refreshPromoPlan(
    plan: PromoPricePlan,
    api: Pick<OzonPromosApi, 'currentProduct'>,
): Promise<PromoPricePlan> {
    const actions = plan.state.ozonActions.map((a) => ({ ...a }));
    let changed = false;
    for (const action of actions) {
        if (!plan.steps.some((s) => s.kind === 'ozon-set' && s.actionId === action.actionId)) continue;
        const current = await api.currentProduct(action.actionId, plan.productId, action.participant);
        if (!current) throw new Error(`Товар ${plan.offerId} отсутствует в свежем списке акции ${action.actionId}`);
        if (!Number.isFinite(current.maxActionPrice) || current.maxActionPrice <= 0)
            throw new Error(`Нет допустимой цены акции ${action.actionId} для ${plan.offerId}`);
        changed ||=
            action.maxActionPrice !== current.maxActionPrice ||
            action.actionPrice !== current.actionPrice ||
            action.participant !== current.participant;
        Object.assign(action, {
            maxActionPrice: current.maxActionPrice,
            actionPrice: current.actionPrice,
            participant: current.participant,
            stock: current.stock,
        });
    }
    const state = { ...plan.state, ozonActions: actions };
    if (!changed) return { ...plan, state };
    const refreshed = planPromoPrice(state, plan.target, plan.percent);
    if (!refreshed.ok) throw new Error('Свежие условия акции не обеспечивают минимальную прибыль: изменение пропущено');
    refreshed.notes.push('План пересчитан: Ozon изменил цену или условия акции после сбора данных');
    return refreshed;
}
