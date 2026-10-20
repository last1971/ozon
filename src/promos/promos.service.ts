import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { chunk as chunkArray } from 'lodash';
import { ozonActionFloor } from '../helpers/price/buyer.price.helper';
import { PriceDto } from '../price/dto/price.dto';
import { PriceRequestDto } from '../price/dto/price.request.dto';
import { PriceService } from '../price/price.service';
import { ProductService } from '../product/product.service';
import { ProductVisibility } from '../product/product.visibility';
import { OzonPromosApi } from './promos.api';
import { Action, ActionProduct, ActionProductUpdate, RejectedProduct } from './promos.types';
import { OzonSellerActionsApi } from './seller-actions.api';

export enum FitProductsStrategy {
    MAX_ACTION_PRICE = 'maxActionPrice',
    MAX_FROM_ACTION_PRICE_AND_MIN_PRICE = 'maxFromActionActionPiceAndProdMinPrice',
    MIN_FROM_MIN_PRICE = 'minFromProdMinPrice',
}

export type AddRemoveProductToAction = {
    action_id: number;
    added: { success_ids: number[]; failed: RejectedProduct[] };
    removed: { success_ids: number[]; failed: RejectedProduct[] };
};

/** Процент нашей seller-акции по product_id; товара нет в акции (или акции нет) → 0. */
type PercentByProduct = Map<number, number>;

/**
 * Бизнес-правила участия товаров в акциях Ozon: что добавить, что снять и по какой цене.
 * С API разговаривает только через `OzonPromosApi` (акции Ozon) и `OzonSellerActionsApi` (наша акция);
 * цены и остатки берёт у ProductService и PriceService. Ничего не знает ни об URL-ах, ни о формате Money.
 *
 * Пол для цены Ozon-акции — не min_price, а min_price / (1 − наш процент): процент нашей seller-акции
 * накладывается поверх цены Ozon-акции и Ozon дно не держит (19.10.2026: 209 из 604 товаров ниже минимума).
 */
@Injectable()
export class PromosService {
    private readonly logger = new Logger(PromosService.name);

    constructor(
        private readonly api: OzonPromosApi,
        private readonly sellerApi: OzonSellerActionsApi,
        private readonly productService: ProductService,
        private readonly priceService: PriceService,
    ) {}

    getActions(): Promise<Action[]> {
        return this.api.listActions();
    }

    /**
     * Снять неподходящее: цена по акции ниже нашей минимальной или товара нет в наличии.
     * @returns сколько товаров снято
     */
    async unfitProductsRemoval(actionId: number): Promise<number> {
        const action = await this.findAction(actionId);
        const inAction = await this.api.listAll('products', actionId);
        const [prices, counts, percents] = await Promise.all([
            this.productService.getProductsPrices(inAction),
            this.productService.getFreeProductCount(inAction.map((p) => p.id)),
            this.sellerPercents(),
        ]);
        const unfit = inAction.filter((p) => {
            const floor = this.floorOf(p.id, prices, percents);
            const count = counts.find((x) => x.id === p.id)?.count ?? 0;
            return floor && (p.actionPrice < floor || count === 0);
        });
        const removed = await this.remove(
            action,
            unfit.map((p) => ({ productId: p.id, actionPrice: this.floorOf(p.id, prices, percents), stock: p.stock })),
        );
        return removed.success_ids.length;
    }

    /**
     * Добавить подходящих кандидатов: наш пол (минимальная с учётом процента нашей акции)
     * укладывается в предельную цену акции и товар есть в наличии. Цена участия — по стратегии.
     * @returns сколько товаров отправлено на добавление
     */
    async fitProductsAddition(actionId: number, strategy: FitProductsStrategy): Promise<number> {
        const candidates = await this.api.listAll('candidates', actionId);
        const [prices, counts, percents] = await Promise.all([
            this.productService.getProductsPrices(candidates),
            this.productService.getFreeProductCount(candidates.map((p) => p.id)),
            this.sellerPercents(),
        ]);
        const updates = candidates
            .filter((c) => {
                const floor = this.floorOf(c.id, prices, percents);
                const count = counts.find((x) => x.id === c.id)?.count ?? 0;
                return floor > 0 && c.maxActionPrice > 0 && c.maxActionPrice >= floor && count > 0;
            })
            .map((c) => ({
                productId: c.id,
                actionPrice: this.priceByStrategy(c, this.floorOf(c.id, prices, percents), strategy),
                stock: c.stock,
            }))
            .filter((u) => u.actionPrice > 0);
        await this.api.update(actionId, updates);
        return updates.length;
    }

    /**
     * Пересмотр участия по списку наших артикулов после пересчёта цен (событие `update.promos`):
     * по каждой акции участник с ценой акции не выше нашего пола снимается,
     * кандидат с предельной ценой не ниже пола добавляется по предельной цене.
     */
    async addRemoveProductToActions(ids: string[], chunkLimit: number = 100): Promise<AddRemoveProductToAction[]> {
        const result: AddRemoveProductToAction[] = [];
        const [actions, prices, percents] = await Promise.all([
            this.api.listActions(),
            this.pricesFor(ids, chunkLimit),
            this.sellerPercents(),
        ]);

        for (const action of actions) {
            const inAction = await this.api.listAll('products', action.id);
            const candidates = await this.api.listAll('candidates', action.id);
            const toRemove: ActionProductUpdate[] = [];
            const toAdd: ActionProductUpdate[] = [];

            for (const price of prices) {
                const floor = ozonActionFloor(Number(price.min_price) || 0, percents.get(price.product_id) ?? 0);
                const participant = inAction.find((p) => p.id === price.product_id);
                if (participant && participant.actionPrice <= floor) {
                    toRemove.push({
                        productId: price.product_id,
                        actionPrice: floor,
                        stock: participant.stock,
                    });
                    continue;
                }
                const candidate = candidates.find((p) => p.id === price.product_id);
                if (candidate && candidate.maxActionPrice >= floor) {
                    toAdd.push({
                        productId: price.product_id,
                        actionPrice: candidate.maxActionPrice,
                        stock: price.fboCount + price.fbsCount,
                    });
                }
            }

            const removed = await this.remove(action, toRemove);
            const added = await this.api.update(action.id, toAdd);
            result.push({
                action_id: action.id,
                removed,
                added: { success_ids: added.added, failed: added.rejected },
            });
        }
        return result;
    }

    @OnEvent('update.promos')
    async handleUpdatePromos(skus: string[]): Promise<void> {
        await this.addRemoveProductToActions(skus);
    }

    /**
     * ЕДИНСТВЕННОЕ правило снятия с акции. Промокодная акция — принудительно (deactivate),
     * остальные («Эластичный бустинг», «Скидка на сток») — через update нашим полом
     * (минимальная с учётом процента нашей акции): выше лимита акции — Ozon исключает товар,
     * в пределах лимита — оставляет с этой ценой, что для нас тоже приемлемо (итог покупателю не ниже минимума).
     * Если Ozon отклонил снятие ценой (эластичный бустинг) — принудительно через deactivate.
     * Открыто для ручки цены (PromoPriceApplier): снятие там идёт этим же правилом, не копией.
     */
    async remove(
        action: Pick<Action, 'id' | 'is_voucher_action'>,
        items: ActionProductUpdate[],
    ): Promise<{ success_ids: number[]; failed: RejectedProduct[] }> {
        if (!items.length) return { success_ids: [], failed: [] };
        if (action.is_voucher_action) {
            const ids = items.map((i) => i.productId);
            const done = await this.api.deactivate(action.id, ids);
            return {
                success_ids: done,
                failed: ids.filter((id) => !done.includes(id)).map((id) => ({ productId: id, reason: 'не снят' })),
            };
        }
        const res = await this.api.update(action.id, items);
        if (res.added.length) {
            this.logger.log(
                `акция ${action.id}: ${res.added.length} товаров остались в акции по нашему полу (в пределах лимита)`,
            );
        }
        if (!res.rejected.length) return { success_ids: res.removed, failed: [] };
        // Эластичный бустинг цену выше лимита не принимает и товар не исключает (20.10.2026, 532100:
        // «DiscountPercent must be greater or equal than 45…») — такие снимаем принудительно.
        const rejectedIds = res.rejected.map((r) => r.productId);
        const forced = await this.api.deactivate(action.id, rejectedIds);
        if (forced.length) this.logger.log(`акция ${action.id}: принудительно сняты ${forced.length} товаров`);
        return {
            success_ids: [...res.removed, ...forced],
            failed: res.rejected.filter((r) => !forced.includes(r.productId)),
        };
    }

    private async findAction(actionId: number): Promise<Action> {
        const action = (await this.api.listActions()).find((a) => Number(a.id) === Number(actionId));
        if (!action) throw new Error(`акция ${actionId} не найдена в списке доступных`);
        return action;
    }

    private async pricesFor(ids: string[], chunkLimit: number): Promise<PriceDto[]> {
        const requests = chunkArray(ids, chunkLimit).map(
            (chunk) => <PriceRequestDto>{ offer_id: chunk, visibility: ProductVisibility.ALL, limit: chunkLimit },
        );
        const responses = await Promise.all(requests.map((r) => this.priceService.index(r)));
        return responses.flatMap((r) => r.data);
    }

    /** Проценты нашей seller-акции по product_id. Акции нет — пустая карта: пол = min_price. */
    private async sellerPercents(): Promise<PercentByProduct> {
        const action = await this.sellerApi.activeAction();
        if (!action) return new Map();
        const products = await this.sellerApi.listAll('list', action.id);
        return new Map(products.filter((p) => p.isActive).map((p) => [p.productId, p.percent]));
    }

    private minPriceOf(id: number, prices: { id: number; price: { min_price?: number | string } }[]): number {
        return Number(prices.find((p) => p.id === id)?.price.min_price ?? 0) || 0;
    }

    /** Пол для цены Ozon-акции товара: min_price / (1 − наш процент); нет min_price → 0 (товар не трогаем). */
    private floorOf(
        id: number,
        prices: { id: number; price: { min_price?: number | string } }[],
        percents: PercentByProduct,
    ): number {
        const minPrice = this.minPriceOf(id, prices);
        return minPrice > 0 ? ozonActionFloor(minPrice, percents.get(id) ?? 0) : 0;
    }

    private priceByStrategy(c: ActionProduct, minPrice: number, strategy: FitProductsStrategy): number {
        switch (strategy) {
            case FitProductsStrategy.MAX_ACTION_PRICE:
                return c.maxActionPrice;
            case FitProductsStrategy.MAX_FROM_ACTION_PRICE_AND_MIN_PRICE:
                return Math.max(c.actionPrice, minPrice);
            default:
                return minPrice;
        }
    }
}
