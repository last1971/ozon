import { ProductCodeDto } from '../product/dto/product.code.dto';

export const goodCode = (value: ProductCodeDto): string => value.offer_id.replace(/-.*/g, '');
export const goodQuantityCoeff = (value: ProductCodeDto): any => {
    const coeff = value.offer_id.replace(/.*-/g, '');
    return coeff === value.offer_id ? 1 : parseInt(coeff);
};
export const productQuantity = (goodQuantity: number, goodCoeff: number) =>
    goodQuantity ? Math.floor(goodQuantity / goodCoeff) : 0;
