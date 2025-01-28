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
            '/v3/product/list',
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
        expect(method.mock.calls[0]).toEqual(['/v4/product/info/stocks', { filter: {}, cursor: '', limit: 100 }]);
    });
    it('test orderList', async () => {
        const date = new Date();
        await service.orderList({ since: date, to: date, status: 'test' });
        expect(method.mock.calls[0]).toEqual([
            '/v3/posting/fbs/list',
            { filter: { since: date, to: date, status: 'test' }, limit: 100, offset: 0 },
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
    it('getGoods', async () => {
        method.mockResolvedValueOnce({
            items: [{
                offer_id: '345',
                stocks: [
                    { type: StockType.FBS, present: 2, reserved: 1 },
                    { type: StockType.FBO, present: 4, reserved: 0 }
                ],
            }],
            cursor: '123',
        });
        const res = await service.getGoods('', [ StockType.FBO]);
        expect(res).toEqual({ goods: new Map([['345', 4]]), nextArgs: '123' });
    });
    it('getGoodIds', async () => {
        method.mockResolvedValueOnce({
            items: [{ offer_id: '345', stocks: [{ type: StockType.FBS, present: 2, reserved: 1 }] }],
            cursor: '123',
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
    it("test getFreeProductCount with valid data", async () => {
        method.mockResolvedValueOnce({
            items: [
                {
                    product_id: 1,
                    stocks: [{ present: 10, reserved: 3 }]
                },
                {
                    product_id: 2,
                    stocks: [{ present: 5, reserved: 2 }]
                }
            ]
        });
        const result = await service.getFreeProductCount([1, 2]);
        expect(result).toEqual([
            { id: 1, count: 7 },
            { id: 2, count: 3 }
        ]);
        expect(method.mock.calls[0]).toEqual([
            "/v4/product/info/stocks",
            { filter: { product_id: [1, 2] }, limit: 100, cursor: "" }
        ]);
    });

    it("test getFreeProductCount with empty productIds", async () => {
        const result = await service.getFreeProductCount([]);
        expect(result).toEqual([]);
        expect(method.mock.calls.length).toBe(0);
    });

    it("test getFreeProductCount handles API error gracefully", async () => {
        method.mockRejectedValueOnce(new Error("API Error"));
        await expect(service.getFreeProductCount([1, 2])).rejects.toThrow("API Error");
    });

});
