import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { OzonRoutesService } from './ozon.routes.service';
import { OzonLogisticsService } from './ozon.logistics.service';
import { OzonPricingService } from './ozon.pricing.service';
import { PriceService } from './price.service';
import { LossPricingService } from '../marketplace-loss/loss-pricing.service';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';
import { calculatePrice } from '../helpers/price/price.helpers';
import { LoadPriceContextCommand } from '../order/profit-check/commands/load-price-context.command';
import { EvaluateCommand } from '../order/profit-check/commands/evaluate.command';
import { PreparePriceReviewCommand } from './price-review.commands';
import { emptyProgress } from '../interfaces/i.job.context';
import { withPricingWarnings, PricingWarning } from '../helpers/price/pricing-warnings';

function setup(database = 'opt', weights = [3, 1], data = new Map<string, any>()) {
    const config = new ConfigService({
        FB_HOST: 'test',
        FB_BASE: database,
        TAX_UNIT: 6,
        MIN_PROFIT_RUB: 20,
        MIN_PROFIT_PERC: 20,
        SUM_OBTAIN: 0,
        SUM_LABEL: 0,
        SUM_PACK: 0,
    });
    const catalog = [
        { sku: '123-5', typeId: 8, volumeWeight: 0.5, fbsCount: 10, fboCount: 0 },
        { sku: '123-10', typeId: 8, volumeWeight: 2, fbsCount: 10, fboCount: 0 },
        { sku: '124-10', typeId: 8, volumeWeight: 0.1, fbsCount: 0, fboCount: 0 },
        { sku: '125', typeId: 9, volumeWeight: 1, fbsCount: 0, fboCount: 0 },
    ];
    const posting = (id: string, offer: string, quantity: number, destination: string) => ({
        posting_number: id,
        status: 'delivered',
        in_process_at: '2026-10-01T00:00:00Z',
        financial_data: { cluster_to: destination },
        products: [{ offer_id: offer, quantity }],
    });
    const fbs = {
        listForLogistics: jest
            .fn()
            .mockResolvedValue([
                posting('moscow', '124-10', weights[0], 'Москва'),
                posting('kazan', '124-10', weights[1], 'Казань'),
                posting('foreign', '125', 1000, 'Чужой кластер'),
            ]),
    };
    const fbo = { listForLogistics: jest.fn().mockResolvedValue([]) };
    const product = (offer_id: string) => ({
        offer_id,
        volume_weight: catalog.find((p) => p.sku === offer_id)?.volumeWeight,
        acquiring: 4,
        price: { price: '400', min_price: '300', old_price: '800', marketing_seller_price: '400' },
        commissions: {
            sales_percent_fbs: 20,
            sales_percent_fbo: 20,
            fbs_direct_flow_trans_min_amount: 9999,
            fbs_direct_flow_trans_max_amount: 9999,
            fbs_deliv_to_customer_amount: 25,
            fbs_first_mile_max_amount: 10,
            fbs_return_flow_amount: 0,
        },
    });
    const products = {
        listAllOfferIds: jest.fn().mockResolvedValue(catalog.map((p) => p.sku)),
        infoList: jest.fn(async (offers: string[]) => catalog.filter((p) => offers.includes(p.sku))),
        getPrices: jest.fn(async ({ offer_id }: { offer_id: string[] }) => ({ items: offer_id.map(product) })),
        setPrice: jest.fn(),
    };
    const cache = {
        get: async (key) => data.get(key),
        set: async (key, value) => {
            data.set(key, value);
        },
    };
    const routes = new OzonRoutesService(config, cache as any, fbs as any, fbo as any, products as any);
    const getRoutes = routes.get.bind(routes);
    jest.spyOn(routes, 'get').mockImplementation(() => getRoutes(new Date('2026-11-08T10:00:00Z')));
    const bands = [
        { min: 0, max: 300, minIncluded: true, maxIncluded: true },
        { min: 300, max: null, minIncluded: false, maxIncluded: false },
    ];
    let scale = 1;
    const tariffs = {
        logistics: jest.fn(async (volume: number) => ({
            loaded: true,
            revision: `v${scale}`,
            rows: bands.flatMap((band, i) =>
                ['Москва', 'Казань'].map((destination, j) => ({
                    band,
                    origin: 'Новосибирск',
                    destination,
                    isDefault: false,
                    volumeFrom: volume,
                    volumeTo: volume,
                    amount: (i ? 100 : 20) * (j + 1) * (volume > 1 ? 10 : 1) * scale,
                })),
            ),
        })),
    };
    const categories = {
        getCommissions: jest.fn().mockResolvedValue({
            fbs: bands.map((band, i) => ({ ...band, rate: i ? 0.5 : 0.2 })),
            fbo: [],
        }),
    };
    const logistics = new OzonLogisticsService(routes, tariffs as any, products as any, cache as any, config);
    const losses = new LossPricingService({ read: async () => null } as any);
    const pricing = new OzonPricingService(categories as any, logistics, config, losses);
    const helper = new PriceCalculationHelper(config);
    const goods = new Trade2006GoodService(null, config, null, null, helper);
    jest.spyOn(goods, 'in').mockImplementation(async codes => codes.map(code => ({ code, name: 'test', quantity: 100, reserve: 0 })));
    jest.spyOn(goods, 'prices').mockResolvedValue([
        { code: 123, name: 'Тестовый товар', price: 20, free_stock: 10, base_source: 'remaining-lots' },
    ]);
    jest.spyOn(goods, 'getPerc').mockImplementation(async () =>
        [5, 10].map((pieces) => ({
            offer_id: '123',
            pieces,
            min_perc: 20,
            perc: 40,
            old_perc: 80,
            adv_perc: 0,
            packing_price: 0,
            available_price: 0,
            return_perc: 0,
        })),
    );
    const service = new PriceService(products as any, goods, config, null, helper, categories as any, pricing);
    return {
        service,
        goods,
        logistics,
        routes,
        fbs,
        products,
        tariffs,
        catalog,
        product,
        setScale: (value: number) => {
            scale = value;
        },
    };
}
beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
afterEach(() => jest.restoreAllMocks());

it('категория → цена → прибыльность заказа → предпросмотр: один расчёт и предупреждение', async () => {
    const m = setup();
    const [built] = await m.goods.buildPriceables(m.service, ['123-5']);
    const result = await m.service.getOzonPricingResult('123-5');
    expect(result.error).toBeUndefined();
    expect(result.warnings).toEqual(['Использована средняя доставка по категории']);
    expect(result.costSources.delivery).toBe('XLSX логистики и история направлений категории');
    expect(result.costs).toMatchObject({ delivery: 25, firstMile: 10, lastMile: 25, returns: 0 });
    expect(Number(calculatePrice(built, m.service.getObtainCoeffs()).min_price)).toBe(result.min.price);
    const extra = { getService: (name: string) => (name === 'ozon' ? m.service : null) };
    const ctx: any = {
        items: [
            {
                resolved: true,
                payload: { service: 'OZON', lines: [{ offer_id: '123-5', units: 1, pricePerUnit: result.min.price }] },
            },
        ],
        warnPercent: 5,
    };
    const loaded = await new LoadPriceContextCommand(extra as any, m.goods).execute(ctx);
    const evaluated = await new EvaluateCommand().execute(loaded);
    expect(evaluated.items[0].verdicts[0].profitPerUnit).toBeCloseTo(result.min.profit, 2);
    expect(evaluated.items[0].level).toBe('ok');
    const preview: any = await new PreparePriceReviewCommand(extra as any, m.goods).execute({
        offerId: '123-5',
        entries: [],
        progress: emptyProgress(),
    });
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].warnings).toEqual(result.warnings);
    expect(Number(preview.entries[0].prices[0].min_price)).toBe(result.min.price);
    expect(m.products.setPrice).not.toHaveBeenCalled();
});
it('средняя для другого объёма использует его тарифы, не стоимость донора и не множитель фасовки', async () => {
    const m = setup();
    const small = await m.logistics.quote(m.product('123-5') as any, m.catalog[0] as any);
    const large = await m.logistics.quote(m.product('123-10') as any, m.catalog[1] as any);
    expect(small.fbs.bands.map((b) => b.amount)).toEqual([25, 125]);
    expect(large.fbs.bands.map((b) => b.amount)).toEqual([250, 1250]);
    expect(m.tariffs.logistics).toHaveBeenNthCalledWith(1, 0.5);
    expect(m.tariffs.logistics).toHaveBeenNthCalledWith(2, 2);
    expect(m.fbs.listForLogistics).toHaveBeenCalledTimes(1);
});
it('категории разных кабинетов изолированы даже при общем кеше', async () => {
    const cache = new Map();
    const opt = setup('opt', [3, 1], cache);
    const shop = setup('magazin', [1, 3], cache);
    const a = await opt.logistics.quote(opt.product('123-5') as any, opt.catalog[0] as any);
    const b = await shop.logistics.quote(shop.product('123-5') as any, shop.catalog[0] as any);
    expect(a.fbs.bands[0].amount).toBe(25);
    expect(b.fbs.bands[0].amount).toBe(35);
    expect(opt.routes.cacheKey).not.toBe(shop.routes.cacheKey);
});
it('сохранённая история не закрепляет старую стоимость при смене тарифа', async () => {
    const m = setup();
    const first = await m.logistics.quote(m.product('123-5') as any, m.catalog[0] as any);
    m.setScale(2);
    const second = await m.logistics.quote(m.product('123-5') as any, m.catalog[0] as any);
    expect(first.fbs.bands[0].amount).toBe(25);
    expect(second.fbs.bands[0].amount).toBe(50);
    expect(second.tariffRevision).toBe('v2');
    expect(m.fbs.listForLogistics).toHaveBeenCalledTimes(1);
});
it('предупреждение попадает в существующий сборщик массового отчёта', async () => {
    const m = setup();
    const warnings = new Map<string, PricingWarning>();
    await withPricingWarnings(warnings, async () => {
        await m.logistics.quote(m.product('123-5') as any, m.catalog[0] as any);
        await m.logistics.quote(m.product('123-5') as any, m.catalog[0] as any);
    });
    expect([...warnings.values()]).toEqual([
        { message: 'Использована средняя доставка по категории', count: 2, examples: ['123-5/fbs'] },
    ]);
});
it('неполный тариф категории останавливает цену с причиной, сохраняя известную закупку', async () => {
    const m = setup();
    const tariff = await m.tariffs.logistics(0.5);
    m.tariffs.logistics.mockResolvedValue({ ...tariff, rows: tariff.rows.filter((r) => r.destination === 'Москва') });
    const result = await m.service.getOzonPricingResult('123-5');
    expect(result.error).toContain('маршрута');
    expect(result.base).toBe(100);
    expect(result.min).toBeNull();
});
