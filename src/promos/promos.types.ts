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
    rejected: RejectedProduct[];
    warnings: string[];
}
