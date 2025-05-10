import { IOfferIdable } from '../../interfaces/IOfferIdable';
import { WbCardDto } from '../../wb.card/dto/wb.card.dto';
import { head } from 'lodash';

/**
 * Получает goodCode из offer_id (до первого дефиса)
 */
export const goodCode = (value: IOfferIdable): string => value.offer_id.toString().replace(/-.*/g, '');

/**
 * Получает коэффициент количества из offer_id (после дефиса), либо 1
 */
export const goodQuantityCoeff = (value: IOfferIdable): number => {
    const offerIdStr = value.offer_id.toString();
    const dashIndex = offerIdStr.indexOf('-');
    if (dashIndex === -1) {
        return 1;
    }
    const coeff = offerIdStr.slice(dashIndex + 1);
    const parsed = parseInt(coeff, 10);
    return isNaN(parsed) ? 1 : parsed;
};

/**
 * Вычисляет количество товаров с учетом коэффициента
 */
export const productQuantity = (goodQuantity: number, goodCoeff: number) =>
    goodQuantity ? Math.floor(goodQuantity / goodCoeff) : 0;

/**
 * Адаптер для преобразования строки в IOfferIdable
 */
export class StringToIOfferIdableAdapter implements IOfferIdable {
    offer_id: string;
    constructor(offer_id: string) {
        this.offer_id = offer_id;
    }
}

/**
 * Проверяет, соответствует ли sku offerId и количеству pieces
 */
export function isSkuMatch(sku: string, offerId: string, pieces: number): boolean {
    if (pieces === 1) {
        return sku === offerId || sku === `${offerId}-1`;
    } else {
        return sku === `${offerId}-${pieces}`;
    }
}

/**
 * Получает количество pieces из объекта или offer_id
 */
export function getPieces(obj: { pieces?: number; offer_id?: string | number }): number {
    if (obj.pieces !== undefined && obj.pieces !== null && obj.pieces !== 0) {
        return obj.pieces;
    }
    if (obj.offer_id !== undefined && obj.offer_id !== null) {
        const offerIdStr = String(obj.offer_id);
        const match = offerIdStr.match(/-(\d+)$/);
        if (match) {
            return Number(match[1]);
        }
    }
    return 1;
}

/**
 * Преобразует массив SKU в массив уникальных goodId
 */
export const skusToGoodIds = (skus: string[]): string[] => {
    const goodIds: string[] = [];
    for (const sku of skus) {
        const goodId = goodCode(new StringToIOfferIdableAdapter(sku));
        if (!goodIds.includes(goodId)) goodIds.push(goodId);
    }
    return goodIds;
};

/**
 * Формирует пары barcode → vendorCode из массива карточек WB
 */
export const barCodeSkuPairs = (cards: WbCardDto[]): Map<string, string> => {
    const skus = new Map<string, string>();
    cards.forEach((card) => {
        const barcode = head(head(card.sizes).skus);
        skus.set(barcode, card.vendorCode);
    });
    return skus;
}; 