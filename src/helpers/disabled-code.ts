import { goodCode } from './product/product.helpers';

export type DisabledLevel = 'good' | 'sku';

/**
 * Единственное место, знающее формат хранения блокировок в GOODS_DISABLED.CODE.
 * good-блок — с префиксом, sku-блок — как есть. Так «11111»-SKU и «11111»-гудскоде
 * лежат разными строками и никогда не путаются. Схему БД не меняем.
 */
const GOOD_PREFIX = 'good:';

/** Как хранить код: гудскоде — с префиксом, sku — как есть. */
export function encodeDisabled(code: string, level: DisabledLevel): string {
    return level === 'good' ? GOOD_PREFIX + code : code;
}

/** Разобрать хранимый код обратно в { code, level } — для показа в списке. */
export function parseDisabled(stored: string): { code: string; level: DisabledLevel } {
    return stored.startsWith(GOOD_PREFIX)
        ? { code: stored.slice(GOOD_PREFIX.length), level: 'good' }
        : { code: stored, level: 'sku' };
}

/** SKU заблокирован, если он сам в наборе (sku-блок) ИЛИ его гудскоде помечен (good-блок). */
export function isDisabled(sku: string, stored: Set<string>): boolean {
    return stored.has(sku) || stored.has(GOOD_PREFIX + goodCode({ offer_id: sku }));
}
