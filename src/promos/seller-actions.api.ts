import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { SellerAction, SellerActionProduct, SellerPercentResult, SellerPercentUpdate } from './promos.types';

/** Акция как её отдаёт /v1/seller-actions/list. */
interface ApiSellerAction {
    action_id: number;
    action_parameters: {
        title: string;
        date_start: string;
        date_end: string;
        status: string;
        discount_type: string;
        min_action_percent: number;
    };
    is_participated: boolean;
    sku_count: number;
    is_turn_on: boolean;
}

/** Товар как его отдают products/list и products/candidates. */
interface ApiSellerActionProduct {
    product_id: number;
    sku: number[];
    offer_id: string;
    name: string;
    base_price: number;
    price: number;
    min_seller_price: number;
    action_price: number;
    discount_percent: number;
    is_active: boolean;
}

interface ApiProductsPage {
    products: ApiSellerActionProduct[];
    has_next: boolean;
    cursor: string;
}

export type SellerActionProductsKind = 'list' | 'candidates';

/**
 * Единственная точка, знающая контракт /v1/seller-actions/* — контур НАШЕЙ акции (по sku, не product_id;
 * проверено живьём 19.10.2026). Отдельный от `OzonPromosApi` (акции Ozon, /v1,/v2/actions по product_id):
 * namespace'ы раздельные, seller-акция старому контуру не видна.
 * Пагинация ТОЛЬКО по cursor: offset игнорируется, has_next при offset всегда true.
 */
@Injectable()
export class OzonSellerActionsApi {
    static readonly PAGE_LIMIT = 100;
    /** Ответ add на «ничего не применилось»: процент ниже min_action_percent, тот же процент, action_price у PERCENT. */
    static readonly NOTHING_APPLIED = 'no activated products found';

    constructor(private readonly ozon: OzonApiService) {}

    async listActions(): Promise<SellerAction[]> {
        const res = await this.ozon.method('/v1/seller-actions/list', {
            limit: OzonSellerActionsApi.PAGE_LIMIT,
            offset: 0,
        });
        return (res?.actions ?? []).map(OzonSellerActionsApi.toAction);
    }

    /** Текущая действующая акция (ACTIVE и включена) или null — тогда нашего процента ни у кого нет. */
    async activeAction(): Promise<SellerAction | null> {
        const actions = await this.listActions();
        return actions.find((a) => a.status === 'ACTIVE' && a.isOn) ?? null;
    }

    /** Все участники или все кандидаты — страницами по cursor до has_next:false. */
    async listAll(kind: SellerActionProductsKind, actionId: number): Promise<SellerActionProduct[]> {
        const all: SellerActionProduct[] = [];
        const seen = new Set<number>();
        let cursor = '';
        for (;;) {
            const page = await this.page(kind, actionId, cursor);
            const fresh = page.products.filter((p) => !seen.has(p.productId));
            if (!fresh.length) break;
            fresh.forEach((p) => seen.add(p.productId));
            all.push(...fresh);
            if (!page.hasNext || !page.cursor || page.cursor === cursor) break;
            cursor = page.cursor;
        }
        return all;
    }

    async page(
        kind: SellerActionProductsKind,
        actionId: number,
        cursor = '',
    ): Promise<{ products: SellerActionProduct[]; hasNext: boolean; cursor: string }> {
        const body: Record<string, unknown> = { action_id: actionId, limit: OzonSellerActionsApi.PAGE_LIMIT };
        if (cursor) body.cursor = cursor;
        const res: ApiProductsPage = await this.ozon.method(`/v1/seller-actions/products/${kind}`, body);
        return {
            products: (res?.products ?? []).map(OzonSellerActionsApi.toProduct),
            hasNext: Boolean(res?.has_next),
            cursor: res?.cursor ?? '',
        };
    }

    /**
     * Назначить процент: и новым кандидатам, и уже активным (меняет вверх и вниз, но не ниже min_action_percent
     * акции). Ozon не говорит, кому именно не применилось — на code5 весь пакет считается отклонённым,
     * поэтому звать по одному товару, если нужна точность.
     */
    async setPercent(actionId: number, products: SellerPercentUpdate[]): Promise<SellerPercentResult> {
        if (!products.length) return { applied: [], rejected: [] };
        const res = await this.ozon.method('/v1/seller-actions/products/add', {
            action_id: actionId,
            products: products.map((p) => ({ sku: p.sku, discount_percent: p.percent })),
        });
        if (res?.error) {
            const reason = String(res.error.message ?? res.error.service_message ?? 'ошибка API');
            return { applied: [], rejected: products.map((p) => ({ sku: p.sku, reason })) };
        }
        return { applied: products, rejected: [] };
    }

    private static toAction(a: ApiSellerAction): SellerAction {
        const p = a.action_parameters ?? ({} as ApiSellerAction['action_parameters']);
        return {
            id: a.action_id,
            title: p.title ?? '',
            discountType: p.discount_type ?? '',
            minPercent: Number(p.min_action_percent ?? 0) || 0,
            dateStart: p.date_start ?? '',
            dateEnd: p.date_end ?? '',
            status: p.status ?? '',
            isOn: Boolean(a.is_turn_on),
            skuCount: a.sku_count ?? 0,
        };
    }

    private static toProduct(p: ApiSellerActionProduct): SellerActionProduct {
        return {
            productId: p.product_id,
            sku: Number(p.sku?.[0] ?? 0) || 0,
            offerId: p.offer_id,
            name: p.name ?? '',
            basePrice: Number(p.base_price ?? 0) || 0,
            price: Number(p.price ?? 0) || 0,
            minSellerPrice: Number(p.min_seller_price ?? 0) || 0,
            actionPrice: Number(p.action_price ?? 0) || 0,
            percent: Number(p.discount_percent ?? 0) || 0,
            isActive: Boolean(p.is_active),
        };
    }
}
