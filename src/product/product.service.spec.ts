import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductVisibility } from './product.visibility';

describe('ProductService', () => {
    let service: ProductService;

    const method = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [ProductService, { provide: OzonApiService, useValue: { method } }],
        }).compile();
        method.mockClear();
        service = module.get<ProductService>(ProductService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test list', async () => {
        await service.list();
        expect(method.mock.calls[0]).toEqual(['/v2/product/list', { last_id: '', limit: 100 }]);
    });
    it('test updateCount', async () => {
        await service.updateCount([{ offer_id: '1', product_id: 1, stock: 1 }]);
        expect(method.mock.calls[0]).toEqual([
            '/v1/product/import/stocks',
            { stocks: [{ offer_id: '1', product_id: 1, stock: 1 }] },
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
});
