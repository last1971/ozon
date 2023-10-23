import { Test, TestingModule } from '@nestjs/testing';
import { WbOrderService } from './wb.order.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { WbApiService } from '../wb.api/wb.api.service';
import { ConfigService } from '@nestjs/config';

describe('WbOrderService', () => {
    let service: WbOrderService;
    const createInvoiceFromPostingDto = jest.fn();
    const method = jest.fn();
    const updateByCommissions = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WbOrderService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: { createInvoiceFromPostingDto, updateByCommissions },
                },
                {
                    provide: WbApiService,
                    useValue: { method },
                },
                {
                    provide: ConfigService,
                    useValue: { get: () => 123456 },
                },
            ],
        }).compile();
        method.mockClear();
        createInvoiceFromPostingDto.mockClear();

        service = module.get<WbOrderService>(WbOrderService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('list', async () => {
        method.mockResolvedValueOnce({ next: null, orders: [] });
        await service.list();
        expect(method.mock.calls[0]).toEqual(['/api/v3/orders', 'get', { dateFrom: 0, limit: 1000, next: 0 }]);
    });

    it('orderStatuses', async () => {
        method.mockResolvedValueOnce({ orders: [] });
        await service.orderStatuses([1, 2, 3]);
        expect(method.mock.calls[0]).toEqual(['/api/v3/orders/status', 'post', { orders: [1, 2, 3] }]);
    });

    it('listByStatus', async () => {
        method.mockResolvedValueOnce({
            orders: [
                { id: 1, supplierStatus: 'new' },
                { id: 2, supplierStatus: 'complete' },
            ],
        });
        const res = await service.listByStatus(
            [
                {
                    id: 1,
                    createdAt: '1',
                    skus: ['1-1'],
                    price: 1.01,
                    article: '11-1',
                    convertedPrice: 1.01,
                    rid: '123',
                },
                {
                    id: 2,
                    createdAt: '2',
                    skus: ['1-2'],
                    price: 2.01,
                    article: '22-1',
                    convertedPrice: 2.01,
                    rid: '321',
                },
            ],
            'new',
        );
        expect(res).toEqual([
            {
                id: 1,
                createdAt: '1',
                skus: ['1-1'],
                price: 1.01,
                rid: '123',
                article: '11-1',
                convertedPrice: 1.01,
            },
        ]);
    });

    it('createInvoice', async () => {
        await service.createInvoice({ in_process_at: '1', posting_number: '1', products: [], status: 'new' }, null);
        expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([
            123456,
            { in_process_at: '1', posting_number: '1', products: [], status: 'new' },
            null,
        ]);
    });

    it('listAwaitingDelivering', async () => {
        method
            .mockResolvedValueOnce({
                orders: [
                    {
                        id: 1,
                        createdAt: '1',
                        skus: ['1-1'],
                        price: 1.01,
                        article: '11-1',
                        convertedPrice: 1.01,
                    },
                    {
                        id: 2,
                        createdAt: '2',
                        skus: ['1-2'],
                        price: 2.01,
                        article: '22-1',
                        convertedPrice: 2.01,
                    },
                ],
            })
            .mockResolvedValueOnce({
                orders: [
                    { id: 1, supplierStatus: 'new' },
                    { id: 2, supplierStatus: 'complete' },
                ],
            });
        const res = await service.listAwaitingDelivering();
        expect(res).toEqual([
            {
                in_process_at: '2',
                posting_number: '2',
                products: [{ offer_id: '22-1', price: '0.020099999999999996', quantity: 1 }],
                status: 'complete',
            },
        ]);
    });

    it('getTransactions', async () => {
        const date = new Date();
        await service.getTransactions({ date: { from: date, to: date }, transaction_type: 'type' });
        expect(method.mock.calls[0]).toEqual([
            '/api/v1/supplier/reportDetailByPeriod',
            'statistics',
            {
                dateFrom: date,
                dateTo: date,
                rrdid: 0,
            },
        ]);
    });

    it('updateTransactions', async () => {
        const date = new Date();
        method
            .mockResolvedValueOnce([
                {
                    order_dt: '2023-10-11T00:00:00.000',
                    srid: '123',
                    delivery_rub: undefined,
                    ppvz_for_pay: undefined,
                    rrd_id: 0,
                },
                {
                    order_dt: date,
                    srid: '123',
                    delivery_rub: 10,
                    ppvz_for_pay: 0,
                    rrd_id: 1,
                },
                {
                    order_dt: '2022-10-12',
                    srid: '123',
                    delivery_rub: 0,
                    ppvz_for_pay: 100,
                    rrd_id: 2,
                },
            ])
            .mockResolvedValueOnce({
                orders: [
                    {
                        id: 12345,
                        createdAt: '2022-10-13',
                        skus: [],
                        price: 100,
                        article: '4444',
                        convertedPrice: 100,
                        rid: '123',
                    },
                    {
                        id: 12345,
                        createdAt: '22-11-1111',
                        skus: [],
                        price: 200,
                        article: '5555',
                        convertedPrice: 200,
                        rid: '124',
                    },
                ],
            });
        await service.updateTransactions({ date: { from: date, to: date }, transaction_type: 'type' });
        expect(method.mock.calls[1]).toEqual([
            '/api/v3/orders',
            'get',
            {
                dateFrom: 1665522000,
                limit: 1000,
                next: 0,
            },
        ]);
        expect(updateByCommissions.mock.calls[0]).toEqual([new Map([['12345', 90]]), null]);
    });
});
