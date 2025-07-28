// Мокаем переменные окружения для тестов ДО импорта
process.env.VAT_RATE = '20';
process.env.PROFIT_TAX_RATE = '20';

import { calculateCosts, calculatePay, calculatePrice, calcNetProfitOSNO, findSellingPriceOSNO, calculateOSNODetails } from './price.helpers';
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

    describe('OSNO functions', () => {
        it('calculateOSNODetails', () => {
            const price = {
                incoming_price: 100,
                available_price: 0,
                sum_pack: 10,
                fbs_direct_flow_trans_max_amount: 20,
                sales_percent: 5,
                adv_perc: 2,
            };
            const percents = {
                sumObtain: 5,
                sumLabel: 3,
                percEkv: 4,
                minMil: 20,
                percMil: 0,
                taxUnit: 0, // ОСНО
            };
            const priceWithVAT = 120; // цена с НДС
            
            const result = calculateOSNODetails(priceWithVAT, price as any, percents as any);
            
            expect(result).toHaveProperty('profitBeforeTax');
            expect(result).toHaveProperty('profitTax');
            expect(result).toHaveProperty('vatToPay');
            expect(typeof result.profitBeforeTax).toBe('number');
            expect(typeof result.profitTax).toBe('number');
            expect(typeof result.vatToPay).toBe('number');
        });

        it('calcNetProfitOSNO', () => {
            const price = {
                incoming_price: 100,
                available_price: 0,
                sum_pack: 10,
                fbs_direct_flow_trans_max_amount: 20,
                sales_percent: 5,
                adv_perc: 2,            
            };
            const percents = {
                sumObtain: 5,
                sumLabel: 3,
                percEkv: 4,
                minMil: 20,
                percMil: 0,
                taxUnit: 0,
            };
            const priceWithVAT = 120;
            
            const result = calcNetProfitOSNO(priceWithVAT, price as any, percents as any);
            
            // Отладка calculateOSNODetails
            const details = calculateOSNODetails(priceWithVAT, price as any, percents as any);            
            // Отладка промежуточных значений
            const { fixedCosts, dynamicCosts } = calculateCosts(price as any, percents as any);
                        
            expect(typeof result).toBe('number');
            expect(result).toBeLessThan(priceWithVAT); // прибыль должна быть меньше цены
        });

        it('findSellingPriceOSNO', () => {
            const price = {
                incoming_price: 100,
                available_price: 0,
                sum_pack: 10,
                fbs_direct_flow_trans_max_amount: 20,
                sales_percent: 5,
                adv_perc: 2,
            };
            const percents = {
                sumObtain: 5,
                sumLabel: 3,
                percEkv: 4,
                minMil: 20,
                percMil: 0,
                taxUnit: 0,
            };
            const percent = 10; // 10% от входящей цены = 10
            
            const result = findSellingPriceOSNO(percent, price as any, percents as any);
            
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
            expect(result).toBeGreaterThan(price.incoming_price); // цена продажи должна быть больше себестоимости
        });

        it('calculatePay with OSNO (taxUnit = 0)', () => {
            const price = {
                incoming_price: 100,
                available_price: 0,
                sum_pack: 10,
                fbs_direct_flow_trans_max_amount: 20,
                sales_percent: 5,
                adv_perc: 2,
            };
            const percents = {
                sumObtain: 5,
                sumLabel: 3,
                percEkv: 4,
                taxUnit: 0, // ОСНО
            };
            const sum = 120;
            
            const result = calculatePay(price as any, percents as any, sum);
            
            expect(typeof result).toBe('number');
            // При ОСНО результат должен отличаться от УСН
        });

        it('calculatePrice with OSNO (taxUnit = 0)', () => {
            const price = {
                incoming_price: 100,
                available_price: 0,
                sum_pack: 10,
                fbs_direct_flow_trans_max_amount: 20,
                sales_percent: 5,
                adv_perc: 2,
                min_perc: 10,
                offer_id: '123',
                old_perc: 100,
                perc: 50,
            };
            const percents = {
                sumObtain: 5,
                sumLabel: 3,
                percEkv: 4,
                taxUnit: 0, // ОСНО
            };
            
            const result = calculatePrice(price as any, percents as any);
            
            expect(result).toHaveProperty('price');
            expect(result).toHaveProperty('min_price');
            expect(result).toHaveProperty('old_price');
            expect(typeof result.price).toBe('string');
            expect(typeof result.min_price).toBe('string');
            expect(typeof result.old_price).toBe('string');
        });
    });
}); 