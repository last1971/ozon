import { calculateCosts, calculatePay, calculatePrice } from './price.helpers';
import { AutoAction } from "../../price/dto/update.price.dto";

describe('Price helpers', () => {
    it('calculateCosts', () => {
        const price = {
            sum_pack: 10,
            fbs_direct_flow_trans_max_amount: 20,
            sales_percent: 5,
            adv_perc: 2,
        };
        const percents = {
            sumObtain: 5,
            sumLabel: 3,
            taxUnit: 1,
            percEkv: 4,
        };
        const { fixedCosts, dynamicCosts } = calculateCosts(price as any, percents as any);
        expect(fixedCosts).toBe(5 + 3 + 10 + 20);
        expect(dynamicCosts).toBe(5 + 1 + 2 + 4);
    });

    it('calculatePay', () => {
        const price = {
            adv_perc: 1,
            fbs_direct_flow_trans_max_amount: 20,
            incoming_price: 100,
            available_price: 0,
            min_perc: 10,
            offer_id: '123',
            old_perc: 100,
            perc: 50,
            sales_percent: 20,
            sum_pack: 0,
        };
        const percents = {
            minMil: 20,
            percMil: 5.5,
            percEkv: 1,
            sumObtain: 25,
            sumLabel: 10,
            taxUnit: 6,
        };
        const result = calculatePay(price as any, percents as any, 250);
        expect(result).toBe(105);
    });

    it('calculatePrice', () => {
        const price = {
            adv_perc: 1,
            fbs_direct_flow_trans_max_amount: 20,
            incoming_price: 1,
            available_price: 100,
            min_perc: 10,
            offer_id: '123',
            old_perc: 100,
            perc: 50,
            sales_percent: 20,
            sum_pack: 0,
        };
        const percents = {
            minMil: 20,
            percMil: 5.5,
            percEkv: 1,
            sumObtain: 25,
            sumLabel: 10,
            taxUnit: 6,
        };
        const result = calculatePrice(price as any, percents as any);
        expect(result).toEqual({
            auto_action_enabled: AutoAction.ENABLED,
            currency_code: 'RUB',
            min_price: '257',
            incoming_price: 1,
            offer_id: '123',
            old_price: '384',
            price: '313',
            price_strategy_enabled: AutoAction.DISABLED,
            sum_pack: 0,
        });
    });
}); 