import { Test, TestingModule } from '@nestjs/testing';
import { YandexOfferService } from './yandex.offer.service';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { StockType } from './dto/stock.item.dto';

describe('YandexOfferService', () => {
    let service: YandexOfferService;
    const method = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [YandexOfferService, { provide: YandexApiService, useValue: { method } }],
        }).compile();

        method.mockClear();
        service = module.get<YandexOfferService>(YandexOfferService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test updateCount', async () => {
        const updatedAt = new Date();
        await service.updateCount(123, [
            { sku: 'abc', warehouseId: 456, items: [{ count: 1, type: StockType.FIT, updatedAt }] },
        ]);
        expect(method.mock.calls[0]).toEqual([
            'campaigns/123/offers/stocks',
            'put',
            { skus: [{ sku: 'abc', warehouseId: 456, items: [{ count: 1, type: StockType.FIT, updatedAt }] }] },
        ]);
    });

    it('test getSkus', async () => {
        method.mockResolvedValueOnce({ result: 'test' });
        const res = await service.getSkus(123);
        expect(res).toEqual('test');
        expect(method.mock.calls[0]).toEqual([
            'campaigns/123/offers?limit=100&page_token=',
            'post',
            { statuses: ['PUBLISHED'] },
        ]);
    });
});
