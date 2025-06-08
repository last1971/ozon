import { goodCode, goodQuantityCoeff, productQuantity, isSkuMatch, getPieces, StringToIOfferIdableAdapter, skusToGoodIds, barCodeSkuPairs } from './product.helpers';

describe('Product helpers', () => {
    it('goodCode', () => {
        expect(goodCode({ offer_id: 'abc123' })).toEqual('abc123');
        expect(goodCode({ offer_id: 'abc-123' })).toEqual('abc');
        expect(goodCode({ offer_id: 'abc - 123' })).toEqual('abc ');
    });
    it('goodQuantityCoeff', () => {
        expect(goodQuantityCoeff({ offer_id: 'abc123' })).toEqual(1);
        expect(goodQuantityCoeff({ offer_id: 'abc-123' })).toEqual(123);
        expect(goodQuantityCoeff({ offer_id: 'abc-1' })).toEqual(1);
        expect(goodQuantityCoeff({ offer_id: '123-10000' })).toEqual(10000);
        expect(goodQuantityCoeff({ offer_id: '123-abc' })).toEqual(1);
        expect(goodQuantityCoeff({ offer_id: '123-0' })).toEqual(0);
    });
    it('productQuantity', () => {
        expect(productQuantity(11, 1)).toEqual(11);
        expect(productQuantity(11, 2)).toEqual(5);
        expect(productQuantity(11, 5)).toEqual(2);
        expect(productQuantity(11, 6)).toEqual(1);
        expect(productQuantity(undefined, 6)).toEqual(0);
        expect(productQuantity(NaN, 6)).toEqual(0);
    });
    describe('isSkuMatch', () => {
        it('совпадает XXXXXX и XXXXXX, если pieces=1', () => {
            expect(isSkuMatch('123456', '123456', 1)).toBe(true);
        });
        it('совпадает XXXXXX-1 и XXXXXX, если pieces=1', () => {
            expect(isSkuMatch('123456-1', '123456', 1)).toBe(true);
        });
        it('совпадает XXXXXX и XXXXXX-1, если pieces=1', () => {
            expect(isSkuMatch('123456', '123456-1', 1)).toBe(false);
        });
        it('совпадает XXXXXX-2 и XXXXXX, если pieces=2', () => {
            expect(isSkuMatch('123456-2', '123456', 2)).toBe(true);
        });
        it('не совпадает XXXXXX и XXXXXX, если pieces=2', () => {
            expect(isSkuMatch('123456', '123456', 2)).toBe(false);
        });
        it('не совпадает XXXXXX-2 и XXXXXX, если pieces=1', () => {
            expect(isSkuMatch('123456-2', '123456', 1)).toBe(false);
        });
    });
    describe('getPieces', () => {
        it('возвращает pieces, если он задан и не 0', () => {
            expect(getPieces({ offer_id: '123', pieces: 5 })).toBe(5);
            expect(getPieces({ offer_id: '123', pieces: 1 })).toBe(1);
        });
        it('игнорирует pieces=0, вычисляет из offer_id', () => {
            expect(getPieces({ offer_id: '123-7', pieces: 0 })).toBe(7);
        });
        it('вычисляет из offer_id-строки', () => {
            expect(getPieces({ offer_id: '123-3' })).toBe(3);
            expect(getPieces({ offer_id: '123-1' })).toBe(1);
        });
        it('вычисляет из offer_id-числа', () => {
            expect(getPieces({ offer_id: 123456 })).toBe(1);
        });
        it('возвращает 1, если ничего не найдено', () => {
            expect(getPieces({ offer_id: 'abc' })).toBe(1);
            expect(getPieces({})).toBe(1);
        });
    });
    it('skusToGoodIds', () => {
        expect(skusToGoodIds(['1111', '1111-10', '1111-20', '23', '24-2'])).toEqual(['1111', '23', '24']);
    });
    it('barCodeSkuPairs', () => {
        const res = barCodeSkuPairs([
            {
                nmID: 1,
                vendorCode: '1',
                subjectID: 111,
                subjectName: 'OneOneOne',
                sizes: [
                    {
                        skus: ['1-1', '1-2'],
                    },
                ],
                title: 'hz1',
                photos: [],
            },
            {
                nmID: 1,
                vendorCode: '2',
                subjectID: 111,
                subjectName: 'OneOneOne',
                sizes: [
                    {
                        skus: ['2-1', '2-2'],
                    },
                    {
                        skus: ['3-1', '3-2'],
                    },
                ],
                title: 'hz2',
                photos: [],
            },
        ] as any);
        expect(res).toEqual(
            new Map([
                ['1-1', '1'],
                ['2-1', '2'],
            ]),
        );
    });
}); 