import { BadRequestException, Injectable } from '@nestjs/common';
import { chunk } from 'lodash';
import { buyerPrice } from '../../helpers/price/buyer.price.helper';
import { priceUpdateQueue } from '../../helpers/price/price-update.queue';
import { assertPricingWritesAllowed } from '../../helpers/price/pricing-review-mode';
import { ProductPriceDto } from '../../price/dto/product.price.dto';
import { ProductService } from '../../product/product.service';
import { ProductVisibility } from '../../product/product.visibility';
import { OzonPromosApi } from '../promos.api';
import { ActionProduct } from '../promos.types';
import { OzonSellerActionsApi } from '../seller-actions.api';
import { OzonPriceWriter } from './ozon-price-writer';
import { guardPlan } from './promo-price.planner';
import {
    OzonActionSlot,
    PromoPriceApplyResult,
    PromoPricePlan,
    PromoPriceState,
    SellerSlot,
} from './promo-price.types';

/**
 * Состояние цен Ozon и план по единому правилу (promo-price.planner). Для решений нужны только цены
 * каталога и наша акция; участие в акциях Ozon читается лишь для просмотра товара в карточке.
 */
@Injectable()
export class PromoPriceService {
    static readonly MAX_OFFERS = 100;
    /** Пересчёт цен идёт по одному товару — список нашей акции живёт минуту, изменённые товары читаются заново. */
    static readonly SELLER_TTL_MS = 60_000;

    private seller?: { until: number; dirty: Set<number>; data: Promise<Map<number, SellerSlot>> };

    constructor(
        private readonly api: OzonPromosApi,
        private readonly sellerApi: OzonSellerActionsApi,
        private readonly productService: ProductService,
        private readonly writer: OzonPriceWriter,
    ) {}

    /** Карточка товара: цены, наша акция и участие в акциях Ozon. */
    async states(offerIds: string[]): Promise<PromoPriceState[]> {
        const states = await this.pricedStates(PromoPriceService.offers(offerIds));
        const ozon = await this.ozonSlots(new Set(states.map((s) => s.productId)));
        return states.map((s) => ({ ...s, ozonActions: ozon.get(s.productId) ?? [] }));
    }

    /** Цены и наша акция по артикулам; без артикулов — весь каталог кабинета. */
    async pricedStates(offerIds?: string[]): Promise<PromoPriceState[]> {
        const offers = [...new Set(offerIds ?? (await this.productService.listAllOfferIds()))];
        if (!offers.length) return [];
        const items: ProductPriceDto[] = [];
        for (const part of chunk(offers, 1000)) {
            const response = await this.productService.getPrices({
                offer_id: part,
                visibility: ProductVisibility.ALL,
                limit: part.length,
            });
            const rows = response?.items;
            const found = new Set(rows?.map((p) => p.offer_id));
            if (!Array.isArray(rows) || found.size !== rows.length || part.some((id) => !found.has(id)))
                throw new Error('Неполный ответ цен Ozon');
            items.push(...rows);
        }
        return this.statesForPrices(items);
    }

    /** Состояние для уже прочитанных цен /v5: добавляет только нашу акцию. */
    async statesForPrices(items: ProductPriceDto[]): Promise<PromoPriceState[]> {
        if (!items.length) return [];
        const seller = await this.sellerSlots(new Set(items.map((i) => i.product_id)));
        return items.map((item) => PromoPriceService.toState(item, seller.get(item.product_id) ?? null));
    }

    /** После нашей записи процент этих товаров в кеше устарел. */
    forget(productIds: number[]) {
        for (const id of productIds) this.seller?.dirty.add(id);
    }

    async plans(offerIds: string[]): Promise<PromoPricePlan[]> {
        const states = await this.pricedStates(PromoPriceService.offers(offerIds));
        return states.map(guardPlan);
    }

    /** Применить: состояние читается заново, план считается заново — плану из браузера не доверяем. */
    async apply(offerIds: string[]): Promise<PromoPriceApplyResult[]> {
        assertPricingWritesAllowed();
        const snapshot = priceUpdateQueue.reader('ozon');
        const plans = await this.plans(offerIds);
        return this.writer.applyPlans(plans, (plan) => ({
            priority: 'manual' as const,
            snapshot: snapshot([plan.offerId, `#product:${plan.productId}`]),
        }));
    }

    private static offers(offerIds: string[]): string[] {
        const ids = [...new Set(offerIds.map((o) => String(o).trim()).filter(Boolean))];
        if (!ids.length) throw new BadRequestException('нет артикулов');
        if (ids.length > PromoPriceService.MAX_OFFERS)
            throw new BadRequestException(`не больше ${PromoPriceService.MAX_OFFERS} артикулов за раз`);
        return ids;
    }

    private static toState(item: ProductPriceDto, seller: SellerSlot | null): PromoPriceState {
        const price = Number(item.price.price) || 0;
        return {
            offerId: item.offer_id,
            productId: item.product_id,
            autoActionEnabled: item.price.auto_action_enabled,
            oldPrice: Number(item.price.old_price) || 0,
            price,
            minPrice: Number(item.price.min_price) || 0,
            buyerPrice: Number(item.price.marketing_seller_price) || 0,
            buyerPriceCalc: buyerPrice(price, [], seller?.isActive && seller.actionOn ? seller.percent : 0),
            seller,
            ozonActions: [],
        };
    }

    private sellerSlots(productIds: Set<number>): Promise<Map<number, SellerSlot>> {
        const entry = this.seller;
        const dirty = entry && [...productIds].some((id) => entry.dirty.has(id));
        if (entry && entry.until > Date.now() && !dirty) return entry.data;
        const next = { until: Infinity, dirty: new Set<number>(), data: undefined as Promise<Map<number, SellerSlot>> };
        next.data = this.readSellerSlots()
            .then((slots) => {
                next.until = Date.now() + PromoPriceService.SELLER_TTL_MS;
                return slots;
            })
            .catch((error) => {
                if (this.seller === next) this.seller = undefined;
                throw error;
            });
        this.seller = next;
        return next.data;
    }

    /** Участники и кандидаты нашей текущей акции — и выключенной: её включение не должно застать цену врасплох. */
    private async readSellerSlots(): Promise<Map<number, SellerSlot>> {
        const slots = new Map<number, SellerSlot>();
        const action = await this.sellerApi.currentAction();
        if (!action) return slots;
        const [list, candidates] = await Promise.all([
            this.sellerApi.listAll('list', action.id),
            this.sellerApi.listAll('candidates', action.id),
        ]);
        // кандидаты первыми, участники перетирают: is_active из list надёжнее
        for (const p of [...candidates, ...list])
            slots.set(p.productId, {
                actionId: action.id,
                title: action.title,
                minPercent: action.minPercent,
                actionOn: action.isOn,
                sku: p.sku,
                percent: p.percent,
                isActive: p.isActive,
            });
        return slots;
    }

    /** Участие и кандидатство в акциях Ozon — для просмотра. */
    private async ozonSlots(productIds: Set<number>): Promise<Map<number, OzonActionSlot[]>> {
        const slots = new Map<number, OzonActionSlot[]>();
        for (const action of await this.api.listActions()) {
            const participants = (await this.api.listAll('products', action.id)).filter((p) => productIds.has(p.id));
            const inAction = new Set(participants.map((p) => p.id));
            const candidates = (await this.api.listAll('candidates', action.id)).filter(
                (p) => productIds.has(p.id) && !inAction.has(p.id),
            );
            const push = (p: ActionProduct, participant: boolean) =>
                slots.set(p.id, [
                    ...(slots.get(p.id) ?? []),
                    {
                        actionId: action.id,
                        title: action.title,
                        isVoucher: Boolean(action.is_voucher_action),
                        participant,
                        actionPrice: participant ? p.actionPrice : 0,
                        maxActionPrice: p.maxActionPrice,
                        stock: p.stock,
                        startsAt: action.date_start || null,
                    },
                ]);
            participants.forEach((p) => push(p, true));
            candidates.forEach((p) => push(p, false));
        }
        return slots;
    }
}
