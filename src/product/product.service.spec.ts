import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductVisibility } from './product.visibility';
import { StockType } from './stock.type';
import { ConfigService } from '@nestjs/config';
import { ProductFilterDto } from "./dto/product.filter.dto";
import { VaultService } from "vault-module/lib/vault.service";
import { ActionListProduct } from 'src/promos/dto/actionsCandidate.dto';

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
        method.mockResolvedValue({ 
            items: [
                { 
                    offer_id: '123', 
                    barcodes: ['barcode1'], 
                    name: 'Product 1', 
                    primary_image: 'image1.jpg',
                    id: 1,
                    stocks: { stocks: [] }
                }
            ] 
        });
        await service.infoList(['123', '123-5']);
        expect(method.mock.calls[0]).toEqual(['/v3/product/info/list', { offer_id: ['123', '123-5'] }]);
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
            '/v5/product/info/prices',
            {
                filter: { product_id: null, offer_id: null, visibility: ProductVisibility.ARCHIVED },
                limit: 0,
                cursor: null,
            },
        ]);
    });
    it('test setPrice', async () => {
        method.mockResolvedValue({ result: [{ updated: true }] });
        const result = await service.setPrice({
            prices: [{ min_price: '1', price: '2', old_price: '3', offer_id: '4', currency_code: 'RUB' }],
        });
        expect(method.mock.calls[0]).toEqual([
            '/v1/product/import/prices',
            {
                prices: [{ min_price: '1', price: '2', old_price: '3', offer_id: '4', currency_code: 'RUB' }],
            },
        ]);
        expect(result).toEqual({ result: [{ updated: true }] });
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

    it('getProductsPrices works', async () => {
        const actionProducts = [
            { id: 1, action_price: 50 },
            { id: 2, action_price: 100 },
            { id: 3, action_price: 150 },
            { id: 4, action_price: 100 },
        ] as ActionListProduct[];
        const productPrices = [
            { product_id: 1, price: { min_price: 50 } },
            { product_id: 2, price: { min_price: 100 } },
            { product_id: 3, price: { min_price: 150 } },
        ];
        const getPricesParams = {
            filter: {
                product_id: [1, 2, 3, 4],
                offer_id: null,
                visibility: 'ALL'
            },
            limit: 100,
            cursor: null
        };

        method.mockResolvedValue({ items: productPrices, cursor: '' });

        const result = await service.getProductsPrices(actionProducts);

        expect(result).toEqual(productPrices.map((i) => ({ id: i.product_id, price: i.price })));
        expect(method.mock.calls[0]).toEqual(['/v5/product/info/prices', getPricesParams]);
    });

    it('getProductsPrices should handle multiple pages', async () => {
        const actionProducts = Array.from({ length: 250 }, (_, i) => ({
            id: i + 1,
            action_price: 100,
        })) as ActionListProduct[];
        const productPrices = actionProducts.map((product) => ({ product_id: product.id, price: { min_price: 100 } }));
        
        method
            .mockResolvedValueOnce({ items: productPrices.slice(0, 100), cursor: '' })
            .mockResolvedValueOnce({ items: productPrices.slice(100, 200), cursor: '' })
            .mockResolvedValueOnce({ items: productPrices.slice(200), cursor: '' });

        const result = await service.getProductsPrices(actionProducts, 100);

        expect(result.length).toEqual(productPrices.length);
        expect(method).toHaveBeenCalledTimes(3);
        expect(method.mock.calls[0][0]).toBe('/v5/product/info/prices');
        expect(method.mock.calls[1][0]).toBe('/v5/product/info/prices');
        expect(method.mock.calls[2][0]).toBe('/v5/product/info/prices');
    });
});
