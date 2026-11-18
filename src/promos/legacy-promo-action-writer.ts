import { Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { buyerPrice } from '../helpers/price/buyer.price.helper';
import { priceUpdateQueue, PricingSnapshot } from '../helpers/price/price-update.queue';
import { ProductPriceDto } from '../price/dto/product.price.dto';
import { ProductService } from '../product/product.service';
import { ProductVisibility } from '../product/product.visibility';
import { OzonPriceTransitionService } from './price-lever/ozon-price-transition.service';
import { PromoPriceService } from './price-lever/promo-price.service';
import { PromoPricePlan, PromoPriceState, PromoPriceStep } from './price-lever/promo-price.types';
import { ActionProductUpdate, RejectedProduct } from './promos.types';

export type LegacyPromoIntent = ActionProductUpdate & { mode: 'add' | 'repair' | 'remove' };
export type LegacyPromoResult = { added: number[]; removed: number[]; failed: RejectedProduct[] };

/** Ручки участия выбирают конкретную акцию и используют общий исполнитель цен. */
@Injectable()
export class LegacyPromoActionWriter {
    constructor(
        private readonly products: ProductService,
        private readonly promos: PromoPriceService,
        private readonly transitions: OzonPriceTransitionService,
    ) {}

    async apply(actionId: number, intents: LegacyPromoIntent[], snapshotFor?: (p: PromoPricePlan) => PricingSnapshot) {
        const result: LegacyPromoResult = { added: [], removed: [], failed: [] };
        if (!intents.length) return result;
        const read = priceUpdateQueue.reader('ozon');
        const prices: ProductPriceDto[] = [];
        for (const ids of chunk(
            intents.map((i) => i.productId),
            1000,
        )) {
            const page = await this.products.getPrices({
                product_id: ids,
                limit: ids.length,
                visibility: ProductVisibility.ALL,
            });
            prices.push(...page.items);
        }
        const states = await this.promos.statesForPrices(prices);
        const byId = new Map(states.map((s) => [s.productId, s]));
        const plans: PromoPricePlan[] = [];
        for (const intent of intents) {
            const state = byId.get(intent.productId);
            try {
                if (!state) throw new Error('У Ozon нет свежего состояния товара');
                const plan = legacyActionPlan(state, actionId, intent);
                plans.push(plan);
            } catch (error) {
                result.failed.push({ productId: intent.productId, reason: error.message });
            }
        }
        const outcomes = await this.transitions.applyPromos(plans, (p) => ({
            priority: 'background',
            snapshot: snapshotFor ? snapshotFor(p) : read([p.offerId, `#product:${p.productId}`]),
        }));
        for (const out of outcomes) {
            if (!out.applied) result.failed.push({ productId: out.productId, reason: out.notes.join('. ') });
            else if (out.steps[0]?.kind === 'ozon-remove') result.removed.push(out.productId);
            else result.added.push(out.productId);
        }
        return result;
    }
}

export function legacyActionPlan(
    state: PromoPriceState,
    actionId: number,
    intent: LegacyPromoIntent,
    now = new Date(),
): PromoPricePlan {
    const slot = state.ozonActions.find((a) => a.actionId === actionId);
    if (!slot) throw new Error('Ozon не подтвердил статус товара в акции');
    if (intent.mode === 'add' ? slot.participant : !slot.participant)
        throw new Error('Участие в акции изменилось после отбора товара');
    if (!Number.isFinite(intent.actionPrice) || intent.actionPrice <= 0)
        throw new Error('Некорректная цена участия в акции');
    const remove =
        intent.mode === 'remove' ||
        (intent.mode === 'repair' && (slot.isVoucher || intent.actionPrice > slot.maxActionPrice));
    if (!remove && (slot.isVoucher || !(slot.maxActionPrice >= intent.actionPrice)))
        throw new Error('Условия акции не допускают указанную цену');
    const step: PromoPriceStep = remove
        ? {
              kind: 'ozon-remove',
              actionId,
              title: slot.title,
              from: slot.actionPrice,
              reason: 'Снятие по условиям акции',
          }
        : {
              kind: 'ozon-set',
              actionId,
              title: slot.title,
              from: slot.participant ? slot.actionPrice : null,
              to: intent.actionPrice,
              stock: intent.stock,
          };
    // Общий планировщик моделирует изменения и начало акций в ближайший час.
    const start = (a: typeof slot) => (a.startsAt ? Date.parse(a.startsAt) : -Infinity);
    const horizon = +now + 3_600_000;
    if (!remove && start(slot) > horizon) throw new Error('Начало акции позже горизонта проверки цены');
    const effective = state.ozonActions
        .filter((a) => start(a) <= horizon)
        .map((a) => (a.actionId === actionId ? (remove ? 0 : intent.actionPrice) : a.participant ? a.actionPrice : 0))
        .filter((p) => p > 0);
    const baseAfter = Math.min(state.price, ...effective);
    const percent = state.seller?.isActive ? state.seller.percent : 0;
    const buyerAfter = buyerPrice(baseAfter, [], percent);
    return {
        offerId: state.offerId,
        productId: state.productId,
        target: buyerAfter,
        percent,
        floor: intent.actionPrice,
        steps: [step],
        buyerBefore: state.buyerPrice,
        baseAfter,
        buyerAfter,
        ok: true,
        closest: false,
        notes: [],
        state,
    };
}
