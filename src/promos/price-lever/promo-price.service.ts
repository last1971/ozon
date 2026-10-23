import { BadRequestException, Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { buyerPrice, ozonPriceActions } from '../../helpers/price/buyer.price.helper';
import { ProductPriceDto } from '../../price/dto/product.price.dto';
import { ProductService } from '../../product/product.service';
import { ProductVisibility } from '../../product/product.visibility';
import { OzonPromosApi } from '../promos.api';
import { ActionProduct } from '../promos.types';
import { OzonSellerActionsApi } from '../seller-actions.api';
import { PromoPriceApplier } from './promo-price.applier';
import { planPromoPrice } from './promo-price.planner';
import {
    OzonActionSlot,
    PromoPriceApplyResult,
    PromoPricePlan,
    PromoPriceState,
    PromoTarget,
    SellerSlot,
} from './promo-price.types';

/**
 * Ручка цены через акции: собирает состояние товара из обоих контуров (акции Ozon — `OzonPromosApi`,
 * наша акция — `OzonSellerActionsApi`, цены — ProductService) и отдаёт план планировщика. Сам ничего не меняет:
 * применение — `PromoPriceApplier` по плану, пересчитанному здесь же из свежего состояния.
 * Дорого: все участники и кандидаты всех акций, ~45 запросов на вызов — для ручной работы, не для списка.
 * Снимок акций читается один раз на вызов независимо от числа товаров — сверка берёт все товары одним снимком.
 */
/** Снимок акций: слоты Ozon-акций и нашей акции по product_id. */
interface PromoSnapshot {
    ozon: Map<number, OzonActionSlot[]>;
    seller: Map<number, SellerSlot>;
}

@Injectable()
export class PromoPriceService {
    static readonly MAX_OFFERS = 100;

    constructor(
        private readonly api: OzonPromosApi,
        private readonly sellerApi: OzonSellerActionsApi,
        private readonly productService: ProductService,
        private readonly applier: PromoPriceApplier,
    ) {}

    async states(offerIds: string[]): Promise<PromoPriceState[]> {
        const ids = [...new Set(offerIds.map((o) => String(o).trim()).filter(Boolean))];
        if (!ids.length) throw new BadRequestException('нет артикулов');
        if (ids.length > PromoPriceService.MAX_OFFERS) {
            throw new BadRequestException(`не больше ${PromoPriceService.MAX_OFFERS} артикулов за раз`);
        }

        const prices = await this.productService.getPrices({
            offer_id: ids,
            visibility: ProductVisibility.ALL,
            limit: ids.length,
        });
        const items = prices.items ?? [];
        const snapshot = await this.snapshot(new Set(items.map((i) => i.product_id)));
        return this.toStates(items, snapshot);
    }

    /**
     * Все товары, которые сейчас в какой-нибудь акции: участники Ozon-акций и участники нашей.
     * Один снимок акций на всех, цены — /v5 пачками по 1000 product_id. Для сверки «ниже минимума».
     */
    async allInActionsStates(): Promise<PromoPriceState[]> {
        const snapshot = await this.snapshot();
        const ids = new Set<number>();
        snapshot.ozon.forEach((slots, id) => slots.some((a) => a.participant) && ids.add(id));
        snapshot.seller.forEach((slot, id) => slot.isActive && ids.add(id));
        const items: ProductPriceDto[] = [];
        for (const part of chunk([...ids], 1000)) {
            const res = await this.productService.getPrices({
                product_id: part,
                visibility: ProductVisibility.ALL,
                limit: part.length,
            });
            items.push(...(res.items ?? []));
        }
        return this.toStates(items, snapshot);
    }

    private toStates(items: ProductPriceDto[], snapshot: PromoSnapshot): PromoPriceState[] {
        const { ozon: ozonSlots, seller: sellerSlots } = snapshot;
        return items.map((item) => {
            const price = Number(item.price.price) || 0;
            const minPrice = Number(item.price.min_price) || 0;
            const seller = sellerSlots.get(item.product_id) ?? null;
            const ozonActions = ozonSlots.get(item.product_id) ?? [];
            const marketing = ozonPriceActions(item.marketing_actions?.actions, minPrice, seller?.title);
            return {
                offerId: item.offer_id,
                productId: item.product_id,
                oldPrice: Number(item.price.old_price) || 0,
                price,
                minPrice,
                buyerPrice: Number(item.price.marketing_seller_price) || 0,
                buyerPriceCalc: buyerPrice(
                    price,
                    marketing.map((a) => a.value),
                    seller?.isActive ? seller.percent : 0,
                ),
                seller,
                ozonActions,
            };
        });
    }

    async plans(offerIds: string[], target: PromoTarget, percent?: number): Promise<PromoPricePlan[]> {
        const parsed = PromoPriceService.parseTarget(target);
        const states = await this.states(offerIds);
        return states.map((s) => planPromoPrice(s, parsed, percent));
    }

    /** Применить: состояние читается заново, план считается заново — плану из браузера не доверяем. По товару подряд. */
    async apply(offerIds: string[], target: PromoTarget, percent?: number): Promise<PromoPriceApplyResult[]> {
        const plans = await this.plans(offerIds, target, percent);
        const results: PromoPriceApplyResult[] = [];
        for (const plan of plans) results.push(await this.applier.apply(plan));
        return results;
    }

    static parseTarget(target: unknown): PromoTarget {
        if (target === 'min' || target === 'normal') return target;
        const t = Number(target);
        if (t > 0) return t;
        throw new BadRequestException(`цель «${target}»: min, normal или цена в рублях`);
    }

    /** Снимок обоих контуров акций; productIds не задан — по всем товарам. */
    private async snapshot(productIds?: Set<number>): Promise<PromoSnapshot> {
        const [ozon, seller] = await Promise.all([this.ozonSlots(productIds), this.sellerSlots(productIds)]);
        return { ozon, seller };
    }

    /** Участие и кандидатство товаров во всех доступных Ozon-акциях; участник важнее кандидата. */
    private async ozonSlots(productIds?: Set<number>): Promise<Map<number, OzonActionSlot[]>> {
        const wanted = (id: number) => !productIds || productIds.has(id);
        const slots = new Map<number, OzonActionSlot[]>();
        const actions = await this.api.listActions();
        for (const action of actions) {
            const participants = (await this.api.listAll('products', action.id)).filter((p) => wanted(p.id));
            const inAction = new Set(participants.map((p) => p.id));
            const candidates = (await this.api.listAll('candidates', action.id)).filter(
                (p) => wanted(p.id) && !inAction.has(p.id),
            );
            const push = (p: ActionProduct, participant: boolean) => {
                const list = slots.get(p.id) ?? [];
                list.push({
                    actionId: action.id,
                    title: action.title,
                    isVoucher: Boolean(action.is_voucher_action),
                    participant,
                    actionPrice: participant ? p.actionPrice : 0,
                    maxActionPrice: p.maxActionPrice,
                    stock: p.stock,
                    startsAt: action.date_start || null,
                });
                slots.set(p.id, list);
            };
            participants.forEach((p) => push(p, true));
            candidates.forEach((p) => push(p, false));
        }
        return slots;
    }

    /** Товары в нашей активной акции (участники) или годные в неё (кандидаты). Акции нет — пусто. */
    private async sellerSlots(productIds?: Set<number>): Promise<Map<number, SellerSlot>> {
        const slots = new Map<number, SellerSlot>();
        const action = await this.sellerApi.activeAction();
        if (!action) return slots;
        const [list, candidates] = await Promise.all([
            this.sellerApi.listAll('list', action.id),
            this.sellerApi.listAll('candidates', action.id),
        ]);
        // кандидаты первыми, участники перетирают: is_active из list надёжнее
        for (const p of [...candidates, ...list]) {
            if (productIds && !productIds.has(p.productId)) continue;
            slots.set(p.productId, {
                actionId: action.id,
                title: action.title,
                minPercent: action.minPercent,
                sku: p.sku,
                percent: p.percent,
                isActive: p.isActive,
            });
        }
        return slots;
    }
}
