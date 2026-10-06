import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { Action, ActionProduct, ActionProductUpdate, ActionUpdateResult } from './promos.types';

/** Деньги в Seller API v2: сумма строкой, валюта (в акциях часто пустая). */
interface Money {
    amount: string;
    currency: string;
}

/** Товар акции как его отдаёт /v2/actions/products и /v2/actions/candidates. */
interface ApiActionProduct {
    id: number;
    price: Money;
    action_price: Money;
    max_action_price: Money;
    stock: number;
    min_stock: number;
    add_mode?: string;
}

interface ApiProductsPage {
    products: ApiActionProduct[];
    total: number;
    last_id: string;
}

export type ActionProductsKind = 'products' | 'candidates';

/**
 * Единственная точка, знающая контракт Seller API по акциям (методы от 22.09.2026,
 * старые отключаются 13.10.2026): URL-ы, формат Money, пагинация по last_id,
 * раздельные списки ответа update. Наружу — доменные типы `promos.types.ts`.
 */
@Injectable()
export class OzonPromosApi {
    static readonly PAGE_LIMIT = 100;

    constructor(private readonly ozon: OzonApiService) {}

    async listActions(): Promise<Action[]> {
        const res = await this.ozon.method('/v1/actions', {}, 'get');
        return res?.result ?? [];
    }

    /** Все участники или все кандидаты акции — страницами по last_id до конца. */
    async listAll(kind: ActionProductsKind, actionId: number): Promise<ActionProduct[]> {
        const all: ActionProduct[] = [];
        let lastId = '';
        for (;;) {
            const page = await this.page(kind, actionId, lastId);
            all.push(...page.products);
            if (page.products.length < OzonPromosApi.PAGE_LIMIT || !page.lastId || page.lastId === lastId) break;
            lastId = page.lastId;
        }
        return all;
    }

    async page(
        kind: ActionProductsKind,
        actionId: number,
        lastId = '',
    ): Promise<{ products: ActionProduct[]; total: number; lastId: string }> {
        const body: Record<string, unknown> = { action_id: actionId, limit: OzonPromosApi.PAGE_LIMIT };
        if (lastId) body.last_id = lastId;
        const res: ApiProductsPage = await this.ozon.method(`/v2/actions/${kind}`, body);
        return {
            products: (res?.products ?? []).map(OzonPromosApi.toProduct),
            total: res?.total ?? 0,
            lastId: res?.last_id ?? '',
        };
    }

    /**
     * Добавить или исключить: цена ≤ лимита акции — товар в акции с этой ценой,
     * выше лимита — исключается (для «Эластичного бустинга» и «Скидки на сток»).
     */
    async update(actionId: number, products: ActionProductUpdate[]): Promise<ActionUpdateResult> {
        if (!products.length) return { added: [], removed: [], rejected: [], warnings: [] };
        const res = await this.ozon.method('/v1/actions/products/update', {
            action_id: actionId,
            products: products.map((p) => ({
                product_id: p.productId,
                action_price: OzonPromosApi.money(p.actionPrice),
                stock: p.stock,
            })),
        });
        return {
            added: res?.active_product_ids ?? [],
            removed: res?.deactivated_product_ids ?? [],
            rejected: (res?.rejected ?? []).map((r: { product_id: number; reason: string }) => ({
                productId: r.product_id,
                reason: String(r.reason ?? ''),
            })),
            warnings: (res?.warnings ?? []).map((w: unknown) => (typeof w === 'string' ? w : JSON.stringify(w))),
        };
    }

    /** Принудительное исключение — только для акций с промокодами; остальным это 400. */
    async deactivate(actionId: number, productIds: number[]): Promise<number[]> {
        if (!productIds.length) return [];
        const res = await this.ozon.method('/v2/actions/products/deactivate', {
            action_id: actionId,
            product_ids: productIds,
        });
        return res?.product_ids ?? [];
    }

    private static toProduct(p: ApiActionProduct): ActionProduct {
        return {
            id: p.id,
            price: OzonPromosApi.amount(p.price),
            actionPrice: OzonPromosApi.amount(p.action_price),
            maxActionPrice: OzonPromosApi.amount(p.max_action_price),
            stock: p.stock ?? 0,
            minStock: p.min_stock ?? 0,
            ...(p.add_mode ? { addMode: p.add_mode } : {}),
        };
    }

    private static amount(m?: Money | null): number {
        return Number(m?.amount ?? 0) || 0;
    }

    private static money(amount: number): Money {
        return { amount: String(amount), currency: 'RUB' };
    }
}
