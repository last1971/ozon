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

    it('test infoList returns volumeWeight', async () => {
        method.mockResolvedValue({
            items: [
                {
                    offer_id: 'sku1',
                    barcodes: [],
                    name: 'Product with volume',
                    primary_image: '',
                    id: 1,
                    type_id: 123,
                    volume_weight: 0.5,
                    stocks: {
                        stocks: [
                            { source: 'fbs', present: 10, reserved: 2 },
                            { source: 'fbo', present: 5, reserved: 1 },
                        ]
                    }
                }
            ]
        });

        const result = await service.infoList(['sku1']);

        expect(result).toHaveLength(1);
        expect(result[0].volumeWeight).toBe(0.5);
        expect(result[0].typeId).toBe(123);
        expect(result[0].fbsCount).toBe(8); // 10 - 2
        expect(result[0].fboCount).toBe(4); // 5 - 1
    });

    it('test infoList handles missing volumeWeight', async () => {
        method.mockResolvedValue({
            items: [
                {
                    offer_id: 'sku2',
                    barcodes: [],
                    name: 'Product without volume',
                    primary_image: '',
                    id: 2,
                    type_id: 456,
                    stocks: { stocks: [] }
                }
            ]
        });

        const result = await service.infoList(['sku2']);

        expect(result).toHaveLength(1);
        expect(result[0].volumeWeight).toBeUndefined();
        expect(result[0].typeId).toBe(456);
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

    it('updateAttributes with offer_ids', async () => {
        method.mockResolvedValue({ task_id: 123 });
        const body = {
            offer_ids: ['sku1', 'sku2'],
            attributes: [{ id: 23518, complex_id: 0, values: [{ value: '1' }] }],
        };

        const result = await service.updateAttributes(body);

        expect(method.mock.calls[0]).toEqual([
            '/v1/product/attributes/update',
            {
                items: [
                    { offer_id: 'sku1', attributes: body.attributes },
                    { offer_id: 'sku2', attributes: body.attributes },
                ],
            },
        ]);
        expect(result).toEqual([{ task_id: 123 }]);
    });

    it('updateAttributes without offer_ids uses skuList', async () => {
        service.skuList = ['sku1', 'sku2', 'sku3'];
        method.mockResolvedValue({ task_id: 456 });
        const body = {
            attributes: [{ id: 23518, complex_id: 0, values: [{ value: '1' }] }],
        };

        const result = await service.updateAttributes(body);

        expect(method.mock.calls[0][1].items.length).toBe(3);
        expect(result).toEqual([{ task_id: 456 }]);
    });

    it('updateAttributes batches over 100 items', async () => {
        service.skuList = Array.from({ length: 150 }, (_, i) => `sku${i}`);
        method.mockResolvedValue({ task_id: 789 });
        const body = {
            attributes: [{ id: 23518, complex_id: 0, values: [{ value: '1' }] }],
        };

        const result = await service.updateAttributes(body);

        expect(method).toHaveBeenCalledTimes(2);
        expect(method.mock.calls[0][1].items.length).toBe(100);
        expect(method.mock.calls[1][1].items.length).toBe(50);
        expect(result).toEqual([{ task_id: 789 }, { task_id: 789 }]);
    });

    it('getTaskInfo', async () => {
        method.mockResolvedValue({ result: { status: 'done' } });

        const result = await service.getTaskInfo(123456);

        expect(method.mock.calls[0]).toEqual(['/v1/product/import/info', { task_id: 123456 }]);
        expect(result).toEqual({ result: { status: 'done' } });
    });

    it('getBuyoutList', async () => {
        const mockProducts = [
            { posting_number: '123-001', amount: 1000, offer_id: 'sku1' },
            { posting_number: '123-002', amount: 2000, offer_id: 'sku2' },
        ];
        method.mockResolvedValue({ products: mockProducts });

        const result = await service.getBuyoutList({ date_from: '2025-01-01', date_to: '2025-01-07' });

        expect(method.mock.calls[0]).toEqual([
            '/v1/finance/products/buyout',
            { date_from: '2025-01-01', date_to: '2025-01-07' },
        ]);
        expect(result).toEqual(mockProducts);
    });

    it('getBuyoutList returns empty array when no products', async () => {
        method.mockResolvedValue({});

        const result = await service.getBuyoutList({ date_from: '2025-01-01', date_to: '2025-01-07' });

        expect(result).toEqual([]);
    });

    it('getCategoryTree', async () => {
        const mockTree = { result: [{ description_category_id: 1, category_name: 'Test' }] };
        method.mockResolvedValue(mockTree);

        const result = await service.getCategoryTree();

        expect(method.mock.calls[0]).toEqual(['/v1/description-category/tree', {}]);
        expect(result).toEqual(mockTree);
    });

    it('getCategoryAttributes', async () => {
        const mockAttrs = { result: [{ id: 85, name: 'Бренд' }] };
        method.mockResolvedValue(mockAttrs);

        const result = await service.getCategoryAttributes(53884411, 971025231);

        expect(method.mock.calls[0]).toEqual([
            '/v1/description-category/attribute',
            { description_category_id: 53884411, language: 'DEFAULT', type_id: 971025231 },
        ]);
        expect(result).toEqual(mockAttrs);
    });

    it('getCategoryAttributeValues single page', async () => {
        const mockValues = [{ id: 1, value: 'Value1' }, { id: 2, value: 'Value2' }];
        method.mockResolvedValue({ result: mockValues, has_next: false });

        const result = await service.getCategoryAttributeValues(85, 53884411, 971025231);

        expect(method.mock.calls[0]).toEqual([
            '/v1/description-category/attribute/values',
            { attribute_id: 85, description_category_id: 53884411, language: 'DEFAULT', last_value_id: 0, limit: 5000, type_id: 971025231 },
        ]);
        expect(result).toEqual(mockValues);
    });

    it('getCategoryAttributeValues with pagination', async () => {
        const page1 = [{ id: 1, value: 'V1' }, { id: 2, value: 'V2' }];
        const page2 = [{ id: 3, value: 'V3' }];
        method
            .mockResolvedValueOnce({ result: page1, has_next: true })
            .mockResolvedValueOnce({ result: page2, has_next: false });

        const result = await service.getCategoryAttributeValues(85, 53884411, 971025231);

        expect(method).toHaveBeenCalledTimes(2);
        expect(method.mock.calls[1][1].last_value_id).toBe(2);
        expect(result).toEqual([...page1, ...page2]);
    });

    it('getCategoryAttributeValues empty response', async () => {
        method.mockResolvedValue({ result: [] });

        const result = await service.getCategoryAttributeValues(85, 53884411, 971025231);

        expect(result).toEqual([]);
    });
});
