import {
    barCodeSkuPairs,
    calculatePay,
    calculatePrice,
    goodCode,
    goodQuantityCoeff,
    productQuantity,
    skusToGoodIds,
} from './index';
import { AutoAction } from '../price/dto/update.price.dto';

describe('Test helpers', () => {
    it('Test goodCode', () => {
        expect(goodCode({ offer_id: 'abc123' })).toEqual('abc123');
        expect(goodCode({ offer_id: 'abc-123' })).toEqual('abc');
        expect(goodCode({ offer_id: 'abc - 123' })).toEqual('abc ');
    });
    it('Test goodQuantityCoeff', () => {
        expect(goodQuantityCoeff({ offer_id: 'abc123' })).toEqual(1);
        expect(goodQuantityCoeff({ offer_id: 'abc-123' })).toEqual(123);
        expect(goodQuantityCoeff({ offer_id: 'abc-1' })).toEqual(1);
    });
    it('Test productQuantity', () => {
        expect(productQuantity(11, 1)).toEqual(11);
        expect(productQuantity(11, 2)).toEqual(5);
        expect(productQuantity(11, 5)).toEqual(2);
        expect(productQuantity(11, 6)).toEqual(1);
        expect(productQuantity(undefined, 6)).toEqual(0);
        expect(productQuantity(NaN, 6)).toEqual(0);
    });
    it('Test calculatePrice', () => {
        expect(
            calculatePrice(
                {
                    adv_perc: 1,
                    fbs_direct_flow_trans_max_amount: 20,
                    incoming_price: 100,
                    min_perc: 10,
                    offer_id: '123',
                    old_perc: 100,
                    perc: 50,
                    sales_percent: 20,
                    sum_pack: 0,
                },
                {
                    minMil: 20,
                    percMil: 5.5,
                    percEkv: 1,
                    sumObtain: 25,
                    sumLabel: 10,
                    taxUnit: 6,
                },
            ),
        ).toEqual({
            auto_action_enabled: AutoAction.ENABLED,
            currency_code: 'RUB',
            min_price: '238',
            incoming_price: 100,
            offer_id: '123',
            old_price: '384',
            price: '289',
            price_strategy_enabled: AutoAction.DISABLED,
            sum_pack: 0,
        });
    });
    it('Test calculatePay', () => {
        expect(
            calculatePay(
                {
                    adv_perc: 1,
                    fbs_direct_flow_trans_max_amount: 20,
                    incoming_price: 100,
                    min_perc: 10,
                    offer_id: '123',
                    old_perc: 100,
                    perc: 50,
                    sales_percent: 20,
                    sum_pack: 0,
                },
                {
                    minMil: 20,
                    percMil: 5.5,
                    percEkv: 1,
                    sumObtain: 25,
                    sumLabel: 10,
                    taxUnit: 6,
                },
                250,
            ),
        ).toEqual(105);
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
        ]);
        expect(res).toEqual(
            new Map([
                ['1-1', '1'],
                ['2-1', '2'],
            ]),
        );
    });
});
