import { ProductCodeDto } from '../product/dto/product.code.dto';
import { ProductPostingDto } from '../product/dto/product.posting.dto';

export const goodCode = (value: ProductCodeDto | ProductPostingDto): string => value.offer_id.replace(/-.*/g, '');
export const goodQuantityCoeff = (value: ProductCodeDto | ProductPostingDto): any => {
    const coeff = value.offer_id.replace(/.*-/g, '');
    return coeff === value.offer_id ? 1 : parseInt(coeff);
};
export const productQuantity = (goodQuantity: number, goodCoeff: number) =>
    goodQuantity ? Math.floor(goodQuantity / goodCoeff) : 0;
