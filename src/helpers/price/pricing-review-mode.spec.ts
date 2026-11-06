import { of } from 'rxjs';
import {
    assertPricingRequestAllowed,
    assertPricingWritesAllowed,
    pricingReviewMode,
    PRICING_WRITE_CRONS,
} from './pricing-review-mode';
import { OzonApiService } from '../../ozon.api/ozon.api.service';
import { WbApiService } from '../../wb.api/wb.api.service';
import { YandexApiService } from '../../yandex.api/yandex.api.service';
import { AvitoApiService } from '../../avito.api/avito.api.service';
import { SyliusApiService } from '../../sylius/sylius.api.service';
import { CronSetupProviderService } from '../../cron.setup.provider/cron.setup.provider.service';
import { PricingModeController } from '../../price/pricing-mode.controller';
import { PromoSweepService } from '../../promos/price-lever/sweep/promo-sweep.service';
import { PriceReviewService } from '../../price/price-review.service';
import { WbPriceService } from '../../wb.price/wb.price.service';

const writes: [Parameters<typeof assertPricingRequestAllowed>[0], string, string][] = [
    ['ozon', '/v1/product/import/prices', 'post'],
    ['ozon', '/v3/product/import', 'post'],
    ['ozon', '/v1/actions/products/update', 'post'],
    ['ozon', '/v2/actions/products/deactivate', 'post'],
    ['ozon', '/v1/actions/products/activate', 'post'],
    ['ozon', '/v1/seller-actions/products/add', 'post'],
    ['ozon', '/v1/actions/discounts-task/approve', 'post'],
    ['ozon', '/v1/actions/discounts-task/decline', 'post'],
    ['wb', 'https://discounts-prices-api.wildberries.ru/api/v2/upload/task', 'post'],
    ['wb', '/public/api/v1/prices', 'post'],
    ['wb', 'https://content-api.wildberries.ru/content/v2/cards/upload', 'post'],
    ['wb', '/public/api/v1/updateDiscounts', 'post'],
    ['wb', '/api/v1/calendar/promotions/upload', 'post'],
    ['yandex', 'businesses/123/offer-prices/updates', 'post'],
    ['yandex', 'v2/campaigns/123/offers/update', 'post'],
    ['avito', '/core/v1/items/123/update_price', 'post'],
    ['sylius', '/api/v2/admin/price/update', 'post'],
];
const reads: typeof writes = [
    ['ozon', '/v1/actions', 'get'],
    ['ozon', '/v2/actions/products', 'post'],
    ['ozon', '/v2/actions/candidates', 'post'],
    ['ozon', '/v1/seller-actions/list', 'post'],
    ['ozon', '/v1/seller-actions/products/list', 'post'],
    ['ozon', '/v1/seller-actions/products/candidates', 'post'],
    ['ozon', '/v1/actions/discounts-task/list', 'post'],
    ['ozon', '/v5/product/info/prices', 'post'],
    ['ozon', '/v3/product/list', 'post'],
    ['ozon', '/v1/product/import/info', 'post'],
    ['ozon', '/v2/products/stocks', 'post'],
    ['ozon', '/v3/posting/fbs/list', 'post'],
    ['wb', 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter', 'get'],
    ['wb', '/api/v3/stocks/1', 'put'],
    ['wb', '/api/v3/orders/new', 'get'],
    ['yandex', 'businesses/123/offer-mappings', 'post'],
    ['avito', '/stock-management/1/info', 'post'],
    ['sylius', '/api/v2/admin/inventory/update', 'post'],
];

describe('режим проверки цен', () => {
    const previous = process.env.PRICING_REVIEW_MODE;
    beforeEach(() => {
        process.env.PRICING_REVIEW_MODE = 'true';
    });
    afterEach(() => {
        if (previous === undefined) delete process.env.PRICING_REVIEW_MODE;
        else process.env.PRICING_REVIEW_MODE = previous;
    });
    it.each(writes)('блокирует %s %s %s', (platform, path, method) => {
        expect(() => assertPricingRequestAllowed(platform, path, method)).toThrow('Режим проверки цен');
    });
    it.each(reads)('разрешает чтение и операции заказов/остатков %s %s %s', (platform, path, method) => {
        expect(() => assertPricingRequestAllowed(platform, path, method)).not.toThrow();
    });
    it('без флага и при false сохраняет прежнюю работу, неизвестное значение закрывает запись', () => {
        for (const value of [undefined, 'false']) {
            if (value === undefined) delete process.env.PRICING_REVIEW_MODE;
            else process.env.PRICING_REVIEW_MODE = value;
            expect(pricingReviewMode()).toBe(false);
            for (const args of writes) expect(() => assertPricingRequestAllowed(...args)).not.toThrow();
        }
        process.env.PRICING_REVIEW_MODE = 'typo';
        expect(() => assertPricingWritesAllowed()).toThrow();
    });
    it('останавливает только ценовые кроны production, возвращает их действительное состояние', () => {
        const names = [...PRICING_WRITE_CRONS, 'checkNewOrders', 'checkGoodCount'];
        const jobs = new Map(
            names.map((name) => {
                const job = {
                    running: true,
                    stop: jest.fn(() => {
                        job.running = false;
                    }),
                    start: jest.fn(),
                    setTime: jest.fn(),
                };
                return [name, job] as const;
            }),
        );
        const scheduler: any = { getCronJobs: () => jobs };
        new CronSetupProviderService(scheduler, { get: () => 'production' } as any).setupConJobs();
        for (const name of PRICING_WRITE_CRONS) {
            expect(jobs.get(name).stop).toHaveBeenCalledTimes(1);
            expect(jobs.get(name).start).not.toHaveBeenCalled();
        }
        expect(jobs.get('checkNewOrders').start).toHaveBeenCalled();
        expect(jobs.get('checkGoodCount').start).toHaveBeenCalled();
        expect(new PricingModeController(scheduler).status()).toEqual({
            reviewMode: true,
            writesAllowed: false,
            crons: [...PRICING_WRITE_CRONS].map((name) => ({ name, running: false })),
        });
    });
    it('реальные API-адаптеры отклоняют запись до HTTP/fetch, чтение Ozon работает', async () => {
        const http: any = { post: jest.fn(() => of({ data: { ok: true } })), get: jest.fn() };
        const vault: any = {
            get: jest.fn(async () => ({ URL: 'https://example.invalid', url: 'https://example.invalid' })),
        };
        const ozon = new OzonApiService(http, vault);
        const wb = new WbApiService(http, vault, {} as any);
        const yandex = new YandexApiService(http, vault);
        const avito = new AvitoApiService(http, vault);
        const sylius = new SyliusApiService(http, {} as any);
        const calls = [
            () => ozon.method('/v1/product/import/prices', {}),
            () => ozon.rawFetch('/v1/actions/products/update', {}),
            () => wb.method('https://discounts-prices-api.wildberries.ru/api/v2/upload/task', 'post', {}, true),
            () => yandex.method('businesses/1/offer-prices/updates', 'post', {}),
            () => avito.request('/core/v1/items/1/update_price', {}),
            () => avito.rawFetch('/core/v1/items/1/update_price', {}),
            () => sylius.method('/api/v2/admin/price/update', 'post', {}),
        ];
        for (const call of calls) await expect(call()).rejects.toThrow('Режим проверки цен');
        expect(http.post).not.toHaveBeenCalled();
        expect(http.get).not.toHaveBeenCalled();
        await expect(ozon.method('/v5/product/info/prices', {})).resolves.toEqual({ ok: true });
        expect(http.post).toHaveBeenCalledTimes(1);
    });
    it('сверка без применения запускается, применение и отправка не создают job', () => {
        const jobs: any = { run: jest.fn(() => ({ id: 'dry-run' })) };
        const sweep = new PromoSweepService(jobs, ...(Array(6).fill({}) as [any, any, any, any, any, any]));
        expect(sweep.start(false, 'min')).toEqual({ id: 'dry-run' });
        expect(jobs.run.mock.calls[0][0].context.apply).toBe(false);
        expect(() => sweep.start(true, 'min')).toThrow('Режим проверки цен');
        const review = new PriceReviewService(jobs, {} as any, {} as any);
        expect(() => review.sendReview('token')).toThrow('Режим проверки цен');
        expect(jobs.run).toHaveBeenCalledTimes(1);
    });
    it('ВБ не меняет даже локальный минимум до отказа в записи', async () => {
        const goods = { getWbData: jest.fn(), setWbData: jest.fn() };
        await expect(WbPriceService.prototype.updatePrices.call({ goodService: goods }, [])).rejects.toThrow(
            'Режим проверки цен',
        );
        expect(goods.getWbData).not.toHaveBeenCalled();
        expect(goods.setWbData).not.toHaveBeenCalled();
    });
});
