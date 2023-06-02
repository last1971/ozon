import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';

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
});
