import { Test, TestingModule } from '@nestjs/testing';
import { WbOrderService } from './wb.order.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { WbApiService } from '../wb.api/wb.api.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { WbOrderDto } from "./dto/wb.order.dto";
import { FetchSalesByStickerCommand } from './commands/fetch-sales-by-sticker.command';
import { FetchOrdersByStickerCommand } from './commands/fetch-orders-by-sticker.command';
import { FetchTransactionsCommand } from './commands/fetch-transactions.command';
import { SelectBestIdCommand } from './commands/select-best-id.command';
import { FetchInvoiceByRemarkCommand } from './commands/fetch-invoice-by-remark.command';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';

describe('WbOrderService', () => {
    let service: WbOrderService;
    let module: TestingModule;
    const createInvoiceFromPostingDto = jest.fn();
    const method = jest.fn();
    const updateByCommissions = jest.fn();
    const emit = jest.fn();
    const isExists = jest.fn();
    const unPickupOzonFbo = jest.fn();
    const pickupInvoice = jest.fn();
    const getTransaction = jest.fn();
    const commit = jest.fn();
    const updatePrim = jest.fn();
    const getByPosting = jest.fn();
    const fetchSalesByStickerExecute = jest.fn();
    const fetchOrdersByStickerExecute = jest.fn();
    const fetchTransactionsExecute = jest.fn();
    const selectBestIdExecute = jest.fn();
    const fetchInvoiceByRemarkExecute = jest.fn();
    getTransaction.mockResolvedValue({ commit });

    beforeEach(async () => {
        // Clear rate limit cache before each test to prevent timeouts
        clearRateLimitCache();

        module = await Test.createTestingModule({
            providers: [
                WbOrderService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        createInvoiceFromPostingDto,
                        updateByCommissions,
                        isExists,
                        unPickupOzonFbo,
                        pickupInvoice,
                        getTransaction,
                        updatePrim,
                        getByPosting,
                    },
                },
                {
                    provide: WbApiService,
                    useValue: { method },
                },
                {
                    provide: ConfigService,
                    useValue: { get: () => 123456 },
                },
                {
                    provide: EventEmitter2,
                    useValue: { emit },
                },
                {
                    provide: FetchSalesByStickerCommand,
                    useValue: { execute: fetchSalesByStickerExecute },
                },
                {
                    provide: FetchOrdersByStickerCommand,
                    useValue: { execute: fetchOrdersByStickerExecute },
                },
                {
                    provide: FetchTransactionsCommand,
                    useValue: { execute: fetchTransactionsExecute },
                },
                {
                    provide: SelectBestIdCommand,
                    useValue: { execute: selectBestIdExecute },
                },
                {
                    provide: FetchInvoiceByRemarkCommand,
                    useValue: { execute: fetchInvoiceByRemarkExecute },
                },
            ],
        }).compile();
        method.mockClear();
        createInvoiceFromPostingDto.mockClear();
        commit.mockClear();
        isExists.mockClear();
        getByPosting.mockClear();
        fetchSalesByStickerExecute.mockClear();
        fetchOrdersByStickerExecute.mockClear();
        fetchTransactionsExecute.mockClear();
        selectBestIdExecute.mockClear();
        fetchInvoiceByRemarkExecute.mockClear();

        // Настраиваем команды так, чтобы они передавали контекст дальше по цепочке
        fetchSalesByStickerExecute.mockImplementation((ctx) => Promise.resolve(ctx));
        fetchOrdersByStickerExecute.mockImplementation((ctx) => Promise.resolve(ctx));
        fetchTransactionsExecute.mockImplementation((ctx) => Promise.resolve(ctx));
        selectBestIdExecute.mockImplementation((ctx) => Promise.resolve(ctx));
        fetchInvoiceByRemarkExecute.mockImplementation((ctx) => Promise.resolve(ctx));

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
                { id: 3, supplierStatus: 'new', wbStatus: 'declined_by_client' },
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
                {
                    id: 3,
                    createdAt: '3',
                    skus: ['1-3'],
                    price: 2.01,
                    article: '33-1',
                    convertedPrice: 2.01,
                    rid: '3211',
                },
            ],
            'new',
        );
        expect(res).toEqual([
            {
                in_process_at: '1',
                posting_number: '1',
                products: [
                    {
                        offer_id: '11-1',
                        price: '0.0101',
                        quantity: 1,
                    },
                ],
                status: 'new',
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
        //expect(emit.mock.calls[0]).toEqual([
        //    'wb.order.created',
        //    { in_process_at: '1', posting_number: '1', products: [], status: 'new' },
        //]);
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
        await service.getTransactions({ from: date, to: date });
        expect(method.mock.calls[0]).toEqual([
            '/api/v5/supplier/reportDetailByPeriod',
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
        method.mockResolvedValueOnce([
            {
                order_dt: date,
                srid: '123',
                delivery_rub: 10,
                ppvz_for_pay: 100,
                additional_payment: 0,
                penalty: 0,
                rrd_id: 1,
                assembly_id: null
            },
            {
                order_dt: date,
                srid: '124',
                delivery_rub: 0,
                ppvz_for_pay: 200,
                additional_payment: 0,
                penalty: 0,
                rrd_id: 2,
                assembly_id: null
            }
        ]);

        await service.updateTransactions({ from: date, to: date }, null);

        // Проверяем вызов API для получения транзакций
        expect(method.mock.calls[0]).toEqual([
            '/api/v5/supplier/reportDetailByPeriod',
            'statistics',
            {
                dateFrom: date,
                dateTo: date,
                rrdid: 0,
            },
        ]);

        // Проверяем вызов updateByCommissions с правильными комиссиями
        expect(updateByCommissions.mock.calls[0]).toEqual([
            new Map([
                ['123', 90], // 100 - 10
                ['124', 200] // 200 - 0
            ]),
            null
        ]);
    });

    it('getAllFboOrders', async () => {
        await service.getAllFboOrders();
        expect(method.mock.calls[0]).toEqual([
            '/api/v1/supplier/orders',
            'statistics',
            { dateFrom: DateTime.now().minus({ day: 2 }).toISODate(), flag: 0 },
        ]);
    });

    it('getOnlyFboOrders', async () => {
        method
            .mockResolvedValueOnce([{ srid: '1' }, { srid: '2' }, { srid: '3' }])
            .mockResolvedValueOnce({ orders: [{ rid: '2' }, { rid: '4' }, { rid: '5' }] });
        const res = await service.getOnlyFboOrders();
        expect(res).toEqual([{ srid: '1' }, { srid: '3' }]);
    });

    it('addFboOrders', async () => {
        method
            .mockResolvedValueOnce([
                { srid: '1' },
                { srid: '2' },
                { srid: '3', totalPrice: 112, supplierArticle: '111', date: '2011-11-11' },
                { srid: '6', totalPrice: 112, supplierArticle: '111', date: '2011-11-11', isCancel: true },
            ])
            .mockResolvedValueOnce({ orders: [{ rid: '2' }, { rid: '4' }, { rid: '5' }] });
        unPickupOzonFbo.mockResolvedValueOnce(true);
        isExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        createInvoiceFromPostingDto.mockResolvedValueOnce('invoice');
        await service.addFboOrders();
        expect(unPickupOzonFbo.mock.calls[0]).toEqual([
            {
                offer_id: '111',
                price: '112',
                quantity: 1,
            },
            'WBFBO',
            { commit },
        ]);
        expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([
            123456,
            {
                in_process_at: '2011-11-11',
                posting_number: '3',
                products: [
                    {
                        offer_id: '111',
                        price: '112',
                        quantity: 1,
                    },
                ],
                status: 'fbo',
            },
            { commit },
        ]);
        expect(pickupInvoice.mock.calls[0]).toEqual(['invoice', { commit }]);
        expect(commit.mock.calls).toHaveLength(1);
    });

    it('checkCanceledOrders', async () => {
        method
            .mockResolvedValueOnce([
                { srid: '1', isCancel: true, date: '2019-11-11' },
                { srid: '2', isCancel: true, date: '2020-11-11' },
                { srid: '3', isCancel: false, date: '2021-11-11' },
                { srid: '4', isCancel: true, date: '2021-11-11' },
            ])
            .mockResolvedValueOnce({
                orders: [
                    { rid: '2', id: 12 },
                    { rid: '4', id: 14 },
                    { rid: '5', id: 15 },
                ],
            });
        isExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await service.checkCanceledOrders();
        expect(isExists.mock.calls).toHaveLength(3);
        expect(updatePrim.mock.calls).toHaveLength(2);
        expect(updatePrim.mock.calls[0]).toEqual(['1', '1 возврат WBFBO', null]);
        expect(updatePrim.mock.calls[1]).toEqual(['14', '14 возврат WBFBO', null]);
    });

    it('transformToPostingDto', async () => {
        const order: WbOrderDto = {
            price: 0,
            rid: '',
            skus: [],
            id: 123,
            convertedPrice: 1000,
            article: 'article1',
            createdAt: new Date().toString(),
        };
        const status = 'new';
        service.transformToPostingDto(order, status);

        // Проверяем, что в Map добавился объект
        const storedPostingDto = Reflect.get(service, 'postingDtos').get(order.id.toString());

        expect(storedPostingDto).toEqual({
            posting_number: order.id.toString(),
            status: status,
            in_process_at: order.createdAt,
            products: [{
                price: (order.convertedPrice / 100).toString(),
                offer_id: order.article,
                quantity: 1,
            }],
        });
    });

    it("should return stickers when API method succeeds", async () => {
        const mockOrders = [1, 2, 3];
        const mockStickers = [{ id: 1, data: "<svg/>" }, { id: 2, data: "<svg/>" }];
        method.mockResolvedValueOnce({ stickers: mockStickers });

        const result = await service.getOrdersStickers(mockOrders);

        expect(method).toHaveBeenCalledWith(
            "/api/v3/orders/stickers?type=svg&width=58&height=40",
            "post",
            { orders: mockOrders },
        );
        expect(result).toEqual({
            stickers: mockStickers,
            success: true,
            error: null
        });
    });

    it("should return an error when API method fails", async () => {
        const mockOrders = [1, 2, 3];
        const mockError = new Error("Failed to fetch stickers");
        method.mockRejectedValueOnce(mockError);

        const result = await service.getOrdersStickers(mockOrders);

        expect(method).toHaveBeenCalledWith(
            "/api/v3/orders/stickers?type=svg&width=58&height=40",
            "post",
            { orders: mockOrders },
        );
        expect(result).toEqual({
            stickers: [],
            success: false,
            error: "Failed to fetch stickers"
        });
    });

    it('getOrders', async () => {
        method.mockResolvedValueOnce([
            { id: 1, sticker: '123', srid: 'srid1' },
            { id: 2, sticker: '456', srid: 'srid2' }
        ]);
        const result = await service.getOrders('2025-09-21', 0);
        expect(method.mock.calls[0]).toEqual([
            '/api/v1/supplier/orders',
            'statistics',
            { dateFrom: '2025-09-21', flag: 0 }
        ]);
        expect(result).toEqual([
            { id: 1, sticker: '123', srid: 'srid1' },
            { id: 2, sticker: '456', srid: 'srid2' }
        ]);
    });

    it('getSales', async () => {
        const dateFrom = '2025-09-21';
        method.mockResolvedValueOnce([
            { srid: 'sale1', sticker: '111' },
            { srid: 'sale2', sticker: '222' }
        ]);
        const result = await service.getSales(dateFrom);
        expect(method.mock.calls[0]).toEqual([
            '/api/v1/supplier/sales',
            'statistics',
            { dateFrom }
        ]);
        expect(result).toEqual([
            { srid: 'sale1', sticker: '111' },
            { srid: 'sale2', sticker: '222' }
        ]);
    });

    it('getInvoiceBySticker should find invoice through command chain', async () => {
        const mockInvoice = {
            id: 123,
            buyerId: 456,
            number: 1,
            status: 1,
            remark: 'WB 5001',
            date: new Date(),
        };

        // Переопределяем моки команд для этого теста
        fetchSalesByStickerExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, srid: 'SRID123' })
        );
        fetchTransactionsExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, transactions: [] })
        );
        selectBestIdExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, selectedId: '5001', selectedIdType: 'assembly_id' })
        );
        fetchInvoiceByRemarkExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, invoice: mockInvoice })
        );

        const result = await service.getInvoiceBySticker({
            dateFrom: '2025-09-21',
            stickerId: '42197484529',
        });

        expect(result).toEqual(mockInvoice);
        expect(fetchSalesByStickerExecute).toHaveBeenCalled();
        expect(fetchInvoiceByRemarkExecute).toHaveBeenCalled();
    });

    it('getInvoiceBySticker should return null if not found', async () => {
        // Переопределяем моки команд для этого теста - ничего не находим
        fetchSalesByStickerExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx }) // srid не найден
        );
        fetchOrdersByStickerExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx }) // srid не найден
        );
        fetchTransactionsExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, stopChain: true }) // останавливаем цепочку
        );

        const result = await service.getInvoiceBySticker({
            dateFrom: '2025-09-21',
            stickerId: '99999999999',
        });

        expect(result).toBeNull();
        expect(fetchSalesByStickerExecute).toHaveBeenCalled();
        expect(fetchOrdersByStickerExecute).toHaveBeenCalled();
    });
});