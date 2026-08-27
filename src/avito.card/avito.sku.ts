import { GoodAvitoDto } from '../good/dto/good.avito.dto';

/** Предельное количество, которое принимает Авито в остатках. */
export const AVITO_MAX_QUANTITY = 999999;

/**
 * Ключ товара для Авито: goodscode либо goodscode-коэффициент.
 * Единственная точка сборки — по этому ключу сходятся остатки и цены.
 *
 * String() обязателен: GOODSCODE в базе INTEGER, а DTO объявляет его строкой.
 * Без приведения в skuList попадают числа, и MapSkusToGoodsCommand падает на sku.includes.
 */
export const avitoSku = ({ goodsCode, coeff }: Pick<GoodAvitoDto, 'goodsCode' | 'coeff'>): string =>
    coeff === 1 ? String(goodsCode) : `${goodsCode}-${coeff}`;
