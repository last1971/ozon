import { CalculatePercentsWithLowCommissionCommand } from './calculate-percents-with-low-commission.command';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { ConfigService } from '@nestjs/config';
import { calculatePrice, calculatePay } from '../../helpers/price/price.helpers';

const make = () => {
    const band = { min: 0, max: null, minIncluded: true, maxIncluded: false };
    const ozon = {
        schemes: [
            {
                scheme: 'fbs',
                commissions: [{ ...band, rate: 0.2 }],
                logistics: [{ ...band, amount: 70 }],
                lastMile: 25,
                firstMile: 10,
                returnFlow: 60,
            },
        ],
        acquiringRate: 0.01,
        minProfitRub: 20,
        minMarkupPercent: 10,
        vatRate: 20,
        profitTaxRate: 20,
    };
    const coeffs = { sumObtain: 5, sumLabel: 2, percMil: 99, minMil: 999, percEkv: 99, taxUnit: 6 };
    const service: any = { withOzonPricing: jest.fn(async (p) => ({ ...p, ozon })), getObtainCoeffs: () => coeffs };
    const helper = new PriceCalculationHelper(new ConfigService({ TAX_UNIT: 6, MIN_PROFIT_RUB: 20 }));
    return { service, helper, coeffs, command: new CalculatePercentsWithLowCommissionCommand(service, helper) };
};
describe('Подбор наценок через единый расчёт Ozon', () => {
    it('использует актуальную доставку 70, а не зашитый тариф 19.32; сохраняет возвраты', async () => {
        const m = make();
        const p: any = {
            offer_id: '123-5',
            typeId: 1,
            volumeWeight: 0.3,
            incoming_price: 100,
            available_price: 0,
            sum_pack: 10,
            adv_perc: 0,
            return_perc: 0.25,
            min_perc: 10,
            perc: 20,
            old_perc: 40,
        };
        await m.command.execute({ skus: [], ozonPrices: [p] });
        expect(m.service.withOzonPricing).toHaveBeenCalledTimes(1);
        expect(p.ozon.schemes[0].logistics[0].amount).toBe(70);
        expect(p.return_perc).toBe(0.25);
        const common = calculatePrice(p, m.coeffs);
        expect(p.min_price).toBe(Number(common.min_price));
        expect(p.price).toBe(Number(common.price));
        expect(p.old_price).toBe(Number(common.old_price));
        expect(calculatePay(p, m.coeffs, p.min_price).netProfit).toBeGreaterThanOrEqual(20);
    });
    it('без базы не рассчитывает и не меняет цену', async () => {
        const m = make();
        const p: any = { offer_id: '1', base_source: 'none', min_price: 100 };
        await m.command.execute({ skus: [], ozonPrices: [p] });
        expect(m.service.withOzonPricing).not.toHaveBeenCalled();
        expect(p.min_price).toBe(100);
    });
    it('ошибка тарифов не подменяется прежней комиссией', async () => {
        const m = make();
        m.service.withOzonPricing.mockRejectedValue(new Error('Нет тарифов'));
        const p: any = { offer_id: '1', incoming_price: 100, min_price: 200 };
        await expect(m.command.execute({ skus: [], ozonPrices: [p] })).rejects.toThrow('Нет тарифов');
        expect(p.min_price).toBe(200);
    });
    it('пустой список не вызывает загрузку', async () => {
        const m = make();
        await m.command.execute({ skus: [] });
        expect(m.service.withOzonPricing).not.toHaveBeenCalled();
    });
});
