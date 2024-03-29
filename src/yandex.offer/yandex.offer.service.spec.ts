import { Test, TestingModule } from '@nestjs/testing';
import { YandexOfferService } from './yandex.offer.service';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { StockType } from './dto/stock.item.dto';
import { VaultService } from 'vault-module/lib/vault.service';
import { GoodsStatsWarehouseStockType } from './dto/goods.stats.warehouse.stock.dto';
import { ConfigService } from '@nestjs/config';

describe('YandexOfferService', () => {
    let service: YandexOfferService;
    const method = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                YandexOfferService,
                { provide: YandexApiService, useValue: { method } },
                {
                    provide: VaultService,
                    useValue: { get: async () => ({ 'electronica-company': 111, 'electronica-fbs-tomsk': '222' }) },
                },
                { provide: ConfigService, useValue: {} },
            ],
        }).compile();

        method.mockClear();
        service = module.get<YandexOfferService>(YandexOfferService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test updateCount', async () => {
        const updatedAt = new Date();
        await service.updateCount([
            { sku: 'abc', warehouseId: 456, items: [{ count: 1, type: StockType.FIT, updatedAt }] },
        ]);
        expect(method.mock.calls[0]).toEqual([
            'campaigns/undefined/offers/stocks',
            'put',
            { skus: [{ sku: 'abc', warehouseId: 456, items: [{ count: 1, type: StockType.FIT, updatedAt }] }] },
        ]);
    });

    it('test index', async () => {
        method.mockResolvedValueOnce({ result: 'test' });
        const res = await service.index();
        expect(res).toEqual('test');
        expect(method.mock.calls[0]).toEqual([
            'campaigns/undefined/offers?limit=100&page_token=',
            'post',
            { statuses: ['PUBLISHED', 'NO_STOCKS', 'CHECKING'] },
        ]);
    });

    it('test getSkus', async () => {
        method.mockResolvedValueOnce({ result: 'test' });
        const res = await service.getSkus(['abc', 'def']);
        expect(res).toEqual('test');
        expect(method.mock.calls[0]).toEqual(['campaigns/undefined/stats/skus', 'post', { shopSkus: ['abc', 'def'] }]);
    });

    it('test getGoodIds', async () => {
        method
            .mockResolvedValueOnce({ result: { offers: [{ offerId: '999' }], paging: { nextPageToken: 'hz' } } })
            .mockResolvedValueOnce({
                result: {
                    shopSkus: [
                        {
                            shopSku: '999',
                            warehouses: [
                                { id: undefined, stocks: [{ type: GoodsStatsWarehouseStockType.AVAILABLE, count: 5 }] },
                            ],
                        },
                    ],
                },
            });
        const res = await service.getGoodIds('');
        expect(res).toEqual({ goods: new Map([['999', 5]]), nextArgs: 'hz' });
    });

    it('test updateGoodCounts', async () => {
        const res = await service.updateGoodCounts(new Map([['999', 5]]));
        expect(res).toEqual(1);
    });
});
