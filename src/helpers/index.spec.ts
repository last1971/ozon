import { goodCode, goodQuantityCoeff, productQuantity } from './index';

describe('Test helpers', () => {
    it('Test goodCode', () => {
        expect(goodCode({ offer_id: 'abc123', product_id: 123 })).toEqual('abc123');
        expect(goodCode({ offer_id: 'abc-123', product_id: 123 })).toEqual('abc');
        expect(goodCode({ offer_id: 'abc - 123', product_id: 123 })).toEqual('abc ');
    });
    it('Test goodQuantityCoeff', () => {
        expect(goodQuantityCoeff({ offer_id: 'abc123', product_id: 123 })).toEqual(1);
        expect(goodQuantityCoeff({ offer_id: 'abc-123', product_id: 123 })).toEqual(123);
        expect(goodQuantityCoeff({ offer_id: 'abc-1', product_id: 123 })).toEqual(1);
    });
    it('Test productQuantity', () => {
        expect(productQuantity(11, 1)).toEqual(11);
        expect(productQuantity(11, 2)).toEqual(5);
        expect(productQuantity(11, 5)).toEqual(2);
        expect(productQuantity(11, 6)).toEqual(1);
    });
});
