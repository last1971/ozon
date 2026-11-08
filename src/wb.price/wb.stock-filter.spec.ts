import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';
import { calculateMarketplaceLossCosts } from '../helpers/price/marketplace.loss.costs';
import { ConfigService } from '@nestjs/config';
import { WbPriceService } from './wb.price.service';
function setup(quantity = 0, marketplace = 0, minPrice = 100, base = 200) {
    const goods = {
        in: jest.fn(async () => [{ code: '123', quantity, reserve: 0 }]),
        getWbData: jest.fn(async () => [{ id: '123-5', minPrice }]),
    };
    const cards = { getFboStocks: jest.fn(async () => new Map([['123-5', marketplace]])) };
    const current = {
        getAll: jest.fn(
            async () => new Map([['123-5', { nmID: 10, price: base, discount: 0, discountedPrice: base }]]),
        ),
    };
    const api = { method: jest.fn() };
    const service = new WbPriceService(
        new ConfigService(),
        goods as any,
        api as any,
        cards as any,
        {} as any,
        current as any,
        { load: async () => new Map() } as any,
    );
    return { goods, cards, api, service };
}
it('товар без целой упаковки у нас и без WB-остатка пропускается до минимальной цены', async () => {
    const s = setup(4, 0, 0);
    const report = await s.service.setMinPrices([], true);
    expect(report.errors).toEqual([]);
    expect(report.skipped).toEqual(['123-5']);
    expect(s.goods.getWbData).not.toHaveBeenCalled();
    expect(s.api.method).not.toHaveBeenCalled();
});
it('при наличии у нас WB API остатков не нужен, отсутствие минимума остаётся ошибкой', async () => {
    const s = setup(5, 0, 0);
    const report = await s.service.setMinPrices([], true);
    expect(report.errors.join(' ')).toContain('нет min_price');
    expect(s.cards.getFboStocks).not.toHaveBeenCalled();
});
it('при наличии только на складе WB сторож продолжает регулировать скидку', async () => {
    const s = setup(0, 2);
    const report = await s.service.setMinPrices([], true);
    expect(report.errors).toEqual([]);
    expect(report.toUpdate).toBe(1);
    expect(s.goods.getWbData).toHaveBeenCalledWith(['123-5']);
    expect(s.api.method).not.toHaveBeenCalled();
});
it('слишком высокая база: понятное требование ручного снижения, граница остаётся 3x', async () => {
    const s = setup(5, 0, 100, 300);
    const report = await s.service.setMinPrices([], true);
    expect(report.errors.join(' ')).toContain('Снизьте базовую цену вручную в кабинете WB');
    expect(report.toUpdate).toBe(0);
});
it('сбой чтения WB не подменяется нулём', async () => {
    const s = setup();
    s.cards.getFboStocks.mockRejectedValueOnce(Error('403'));
    const report = await s.service.setMinPrices([], true);
    expect(report.errors.join(' ')).toContain('Не удалось прочитать остатки');
    expect(report.skipped).toEqual([]);
    expect(s.api.method).not.toHaveBeenCalled();
});

it('склад WB без нашего остатка: общий сборщик сохраняет закупку упаковки и резерв брака', async () => {
    const config = new ConfigService({ SUM_LABEL: 0, SUM_PACK: 0, TAX_UNIT: 6 });
    const goods = new Trade2006GoodService(null, config, null, null, new PriceCalculationHelper(config));
    jest.spyOn(goods, 'in').mockResolvedValue([{ code: '123', name: 'test', quantity: 0, reserve: 0 }]);
    jest.spyOn(goods, 'prices').mockResolvedValue([
        { code: 123, name: 'test', price: null, purchase_price: 20, free_stock: 0, base_source: 'all-receipts' },
    ]);
    jest.spyOn(goods, 'getPerc').mockResolvedValue([
        {
            offer_id: '123',
            pieces: 5,
            min_perc: 20,
            perc: 40,
            old_perc: 80,
            adv_perc: 0,
            packing_price: 0,
            available_price: 0,
        },
    ]);
    jest.spyOn(goods, 'getWbData').mockResolvedValue([{ id: '123-5', commission: 20, tariff: 10 }] as any);
    const wb = new WbPriceService(
        config,
        goods,
        {} as any,
        { getFboStocks: async () => new Map([['123-5', 2]]) } as any,
        {} as any,
        {} as any,
        {
            load: async () =>
                new Map([
                    [
                        '123-5',
                        {
                            defectRate: 0.1,
                            confirmedDefectCompensation: 0,
                            paidReturnDelivery: 0,
                            cancellationDelivery: 0,
                            sellerReturnDelivery: 0,
                        },
                    ],
                ]),
        } as any,
    );
    const [built] = await goods.buildPriceables(wb, ['123-5']);
    expect(built.incoming_price).toBe(100);
    expect(built.lossCosts.purchaseCost).toBe(100);
    expect(calculateMarketplaceLossCosts(built.lossCosts, 0).defects).toBe(10);
});
