import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductVisibility } from './product.visibility';
import { StockType } from './stock.type';
import { ConfigService } from '@nestjs/config';
import { ProductFilterDto } from "./dto/product.filter.dto";
import { VaultService } from "vault-module/lib/vault.service";

describe('ProductService', () => {
    let service: ProductService;

    const method = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProductService,
                { provide: OzonApiService, useValue: { method } },
                { provide: ConfigService, useValue: {} },
                { provide: VaultService, useValue: { get: { STORE: 444 }}},
            ],
        }).compile();
        method.mockClear();
        service = module.get<ProductService>(ProductService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test list', async () => {
        await service.list();
        expect(method.mock.calls[0]).toEqual([
            '/v2/product/list',
            { filter: new ProductFilterDto(), last_id: '', limit: 100 }
        ]);
    });

    it('test listInfo', async () => {
        await service.infoList(['123', '123-5']);
        expect(method.mock.calls[0]).toEqual(['/v2/product/info/list', { offer_id: ['123', '123-5'] }]);
    });

    it('test updateCount', async () => {
        await service.updateCount([{ offer_id: '1', product_id: 1, stock: 1 }]);
        expect(method.mock.calls[0]).toEqual([
            '/v2/products/stocks',
            { stocks: [{ offer_id: '1', product_id: 1, stock: 1, warehouse_id: undefined }] },
        ]);
    });
    it('test listWithCount', async () => {
        await service.listWithCount();
        expect(method.mock.calls[0]).toEqual(['/v3/product/info/stocks', { filter: {}, last_id: '', limit: 100 }]);
    });
    it('test orderList', async () => {
        const date = new Date();
        await service.orderList({ since: date, to: date, status: 'test' });
        expect(method.mock.calls[0]).toEqual([
            '/v3/posting/fbs/list',
            { filter: { since: date, to: date, status: 'test' }, limit: 100 },
        ]);
    });
    it('test getPrices', async () => {
        await service.getPrices({ limit: 0, visibility: ProductVisibility.ARCHIVED });
        expect(method.mock.calls[0]).toEqual([
            '/v4/product/info/prices',
            {
                filter: { product_id: null, offer_id: null, visibility: ProductVisibility.ARCHIVED },
                limit: 0,
                last_id: null,
            },
        ]);
    });
    it('test setPrice', async () => {
        await service.setPrice({
            prices: [{ min_price: '1', price: '2', old_price: '3', offer_id: '4', currency_code: 'RUB' }],
        });
        expect(method.mock.calls[0]).toEqual([
            '/v1/product/import/prices',
            {
                prices: [{ min_price: '1', price: '2', old_price: '3', offer_id: '4', currency_code: 'RUB' }],
            },
        ]);
    });
    it('test getTransaction', async () => {
        const date = new Date();
        method.mockResolvedValue({ result: { operations: [], page_count: 1 } });
        const filter = { date: { from: date, to: date }, transaction_type: 'test' };
        await service.getTransactionList(filter);
        expect(method.mock.calls[0]).toEqual(['/v3/finance/transaction/list', { filter, page: 1, page_size: 1000 }]);
    });
    it('getGoodIds', async () => {
        method.mockResolvedValueOnce({
            result: {
                items: [{ offer_id: '345', stocks: [{ type: StockType.FBS, present: 2, reserved: 1 }] }],
                last_id: '123',
            },
        });
        const res = await service.getGoodIds('');
        expect(res).toEqual({ goods: new Map([['345', 1]]), nextArgs: '123' });
    });
    it('updateGoodCounts', async () => {
        method.mockResolvedValueOnce({ result: [2] });
        const res = await service.updateGoodCounts(new Map([['1', 1]]));
        expect(res).toEqual(1);
        expect(method.mock.calls[0]).toEqual(['/v2/products/stocks', { stocks: [{ offer_id: '1', stock: 1, warehouse_id: undefined }] }]);
    });
    it('orderFboList', async () => {
        const date = new Date();
        await service.orderFboList({
            limit: 1,
            filter: { since: date, to: date, status: 'staus' },
            with: { analytics_data: false },
        });
        expect(method.mock.calls[0]).toEqual([
            '/v2/posting/fbo/list',
            {
                limit: 1,
                filter: { since: date, to: date, status: 'staus' },
                with: { analytics_data: false },
            },
        ]);
    });
});
