import { GoodAvitoDto } from '../good/dto/good.avito.dto';

/** Предельное количество, которое принимает Авито в остатках. */
export const AVITO_MAX_QUANTITY = 999999;

/**
 * Ключ товара для Авито: goodscode либо goodscode-коэффициент.
 * Единственная точка сборки — по этому ключу сходятся остатки и цены.
 */
export const avitoSku = ({ goodsCode, coeff }: Pick<GoodAvitoDto, 'goodsCode' | 'coeff'>): string =>
    coeff === 1 ? goodsCode : `${goodsCode}-${coeff}`;
