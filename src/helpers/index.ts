import { IOfferIdable } from '../interfaces/IOfferIdable';

export const goodCode = (value: IOfferIdable): string => value.offer_id.replace(/-.*/g, '');
export const goodQuantityCoeff = (value: IOfferIdable): any => {
    const coeff = value.offer_id.replace(/.*-/g, '');
    return coeff === value.offer_id ? 1 : parseInt(coeff);
};
export const productQuantity = (goodQuantity: number, goodCoeff: number) =>
    goodQuantity ? Math.floor(goodQuantity / goodCoeff) : 0;
