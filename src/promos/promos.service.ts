import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { chunk as chunkArray } from 'lodash';
import { PriceDto } from '../price/dto/price.dto';
import { PriceRequestDto } from '../price/dto/price.request.dto';
import { PriceService } from '../price/price.service';
import { ProductService } from '../product/product.service';
import { ProductVisibility } from '../product/product.visibility';
import { OzonPromosApi } from './promos.api';
import { Action, ActionProduct, ActionProductUpdate, RejectedProduct } from './promos.types';

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

/**
 * Бизнес-правила участия товаров в акциях Ozon: что добавить, что снять и по какой цене.
 * С API разговаривает только через `OzonPromosApi`; цены и остатки берёт у ProductService
 * и PriceService. Ничего не знает ни об URL-ах, ни о формате Money.
 */
@Injectable()
export class PromosService {
    private readonly logger = new Logger(PromosService.name);

    constructor(
        private readonly api: OzonPromosApi,
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
        const prices = await this.productService.getProductsPrices(inAction);
        const counts = await this.productService.getFreeProductCount(inAction.map((p) => p.id));
        const unfit = inAction.filter((p) => {
            const minPrice = Number(prices.find((x) => x.id === p.id)?.price.min_price);
            const count = counts.find((x) => x.id === p.id)?.count ?? 0;
            return minPrice && (p.actionPrice < minPrice || count === 0);
        });
        const removed = await this.remove(
            action,
            unfit.map((p) => ({ productId: p.id, actionPrice: this.minPriceOf(p.id, prices), stock: p.stock })),
        );
        return removed.success_ids.length;
    }

    /**
     * Добавить подходящих кандидатов: наша минимальная цена укладывается в предельную
     * цену акции и товар есть в наличии. Цена участия — по стратегии.
     * @returns сколько товаров отправлено на добавление
     */
    async fitProductsAddition(actionId: number, strategy: FitProductsStrategy): Promise<number> {
        const candidates = await this.api.listAll('candidates', actionId);
        const prices = await this.productService.getProductsPrices(candidates);
        const counts = await this.productService.getFreeProductCount(candidates.map((p) => p.id));
        const updates = candidates
            .filter((c) => {
                const minPrice = this.minPriceOf(c.id, prices);
                const count = counts.find((x) => x.id === c.id)?.count ?? 0;
                return minPrice > 0 && c.maxActionPrice > 0 && c.maxActionPrice >= minPrice && count > 0;
            })
            .map((c) => ({
                productId: c.id,
                actionPrice: this.priceByStrategy(c, this.minPriceOf(c.id, prices), strategy),
                stock: c.stock,
            }))
            .filter((u) => u.actionPrice > 0);
        await this.api.update(actionId, updates);
        return updates.length;
    }

    /**
     * Пересмотр участия по списку наших артикулов после пересчёта цен (событие `update.promos`):
     * по каждой акции участник с ценой акции не выше нашей минимальной снимается,
     * кандидат с предельной ценой не ниже нашей минимальной добавляется по предельной цене.
     */
    async addRemoveProductToActions(ids: string[], chunkLimit: number = 100): Promise<AddRemoveProductToAction[]> {
        const result: AddRemoveProductToAction[] = [];
        const actions = await this.api.listActions();
        const prices = await this.pricesFor(ids, chunkLimit);

        for (const action of actions) {
            const inAction = await this.api.listAll('products', action.id);
            const candidates = await this.api.listAll('candidates', action.id);
            const toRemove: ActionProductUpdate[] = [];
            const toAdd: ActionProductUpdate[] = [];

            for (const price of prices) {
                const participant = inAction.find((p) => p.id === price.product_id);
                if (participant && participant.actionPrice <= price.min_price) {
                    toRemove.push({
                        productId: price.product_id,
                        actionPrice: price.min_price,
                        stock: participant.stock,
                    });
                    continue;
                }
                const candidate = candidates.find((p) => p.id === price.product_id);
                if (candidate && candidate.maxActionPrice >= price.min_price) {
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
     * остальные («Эластичный бустинг», «Скидка на сток») — через update нашей минимальной
     * ценой: выше лимита акции — Ozon исключает товар, в пределах лимита — оставляет
     * с этой ценой, что для нас тоже приемлемо (продавать по минимальной можно).
     */
    private async remove(
        action: Action,
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
                `акция ${action.id}: ${res.added.length} товаров остались в акции по минимальной цене (в пределах лимита)`,
            );
        }
        return { success_ids: res.removed, failed: res.rejected };
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

    private minPriceOf(id: number, prices: { id: number; price: { min_price?: number | string } }[]): number {
        return Number(prices.find((p) => p.id === id)?.price.min_price ?? 0) || 0;
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
