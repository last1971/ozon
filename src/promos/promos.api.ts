import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { Action, ActionProduct } from './promos.types';

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
 * Чтение акций Ozon (методы от 22.09.2026): URL-ы, формат Money, пагинация по last_id.
 * Записи нет: с 12.10.2026 цена в акции и есть цена товара — её задаёт импорт цены.
 */
@Injectable()
export class OzonPromosApi {
    static readonly PAGE_LIMIT = 100;

    constructor(private readonly ozon: OzonApiService) {}

    async listActions(): Promise<Action[]> {
        const res = await this.ozon.method('/v1/actions', {}, 'get');
        if (!Array.isArray(res?.result)) throw new Error(OzonPromosApi.errorText(res) || 'Ozon не вернул список акций');
        return res.result;
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
        const error = OzonPromosApi.errorText(res);
        if (error) throw new Error(error);
        if (!Array.isArray(res?.products)) throw new Error('Ozon не вернул список товаров акции');
        return {
            products: res.products.map(OzonPromosApi.toProduct),
            total: res?.total ?? 0,
            lastId: res?.last_id ?? '',
        };
    }

    /** Текст ошибки, которую OzonApiService вернул вместо ответа ({ error: { message } }); нет ошибки — ''. */
    private static errorText(res: any): string {
        const e = res?.error;
        return e ? String(e.message || e.service_message || 'ошибка Ozon без текста') : '';
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
}
