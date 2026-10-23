/**
 * Доменные типы акций Ozon. Здесь — числа в рублях и camelCase, без Money и без
 * имён полей Seller API: контракт API (v2, 13.10.2026) знает только `OzonPromosApi`.
 */

/** Акция из GET /v1/actions (структура не менялась — оставлен исходный DTO). */
export type { ActionsDto as Action } from './dto/actions.dto';

/** Товар в акции или кандидат на участие. */
export interface ActionProduct {
    id: number;
    /** Текущая цена без скидки. */
    price: number;
    /** Цена по акции (у кандидата 0 — ещё не назначена). */
    actionPrice: number;
    /** Предельная цена, с которой товар проходит в акцию. */
    maxActionPrice: number;
    /** Единиц в акции «Скидка на сток». */
    stock: number;
    minStock: number;
    /** AUTO | NORMAL — есть только у участников. */
    addMode?: string;
}

/** Что отправляем по товару в акцию: предельная цена и сток. */
export interface ActionProductUpdate {
    productId: number;
    actionPrice: number;
    stock: number;
}

export interface RejectedProduct {
    productId: number;
    reason: string;
}

/** Ответ /v1/actions/products/update: один вызов и добавляет, и исключает. */
export interface ActionUpdateResult {
    added: number[];
    removed: number[];
    /** Ozon: «Product update has no changes» — запрошенное уже стоит (цена та же / товара в акции уже нет). */
    unchanged: number[];
    rejected: RejectedProduct[];
    warnings: string[];
}

/* ---------- Наша акция (контур /v1/seller-actions, по sku) ---------- */

/** Акция продавца из seller-actions/list. minPercent — ниже этого процента Ozon товар не принимает (code5). */
export interface SellerAction {
    id: number;
    title: string;
    /** PERCENT | FINAL_PRICE */
    discountType: string;
    minPercent: number;
    dateStart: string;
    dateEnd: string;
    status: string;
    isOn: boolean;
    skuCount: number;
}

/** Товар в нашей акции (products/list) или кандидат (products/candidates). sku ≠ offer_id. */
export interface SellerActionProduct {
    productId: number;
    sku: number;
    offerId: string;
    name: string;
    /** Цена без скидок (old_price). */
    basePrice: number;
    /** Наша price. */
    price: number;
    /** Наша min_price как её видит акция. */
    minSellerPrice: number;
    /** price × (1 − percent). */
    actionPrice: number;
    percent: number;
    isActive: boolean;
}

export interface SellerPercentUpdate {
    sku: number;
    percent: number;
}

/** Ответ add: Ozon отвечает `{}` на успех и code5 «no activated products found», если ничего не применилось. */
export interface SellerPercentResult {
    applied: SellerPercentUpdate[];
    rejected: { sku: number; reason: string }[];
}
