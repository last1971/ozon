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
import { FboInvoiceCreatorService } from '../posting.fbo/fbo-invoice-creator.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';
import { WbCustomerService } from '../wb.customer/wb.customer.service';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';

describe('WbOrderService', () => {
    let service: WbOrderService;
    let module: TestingModule;
    const createInvoiceFromPostingDto = jest.fn();
    const method = jest.fn();
    const updateByCommissions = jest.fn();
    const emit = jest.fn();
    const getClaims = jest.fn().mockResolvedValue({ claims: [], total: 0 });
    const mpRecord = jest.fn().mockResolvedValue(true);
    const mpFirstSeen = jest.fn().mockResolvedValue(null);
    const mpIsHandled = jest.fn().mockResolvedValue(false);
    const mpMarkHandled = jest.fn().mockResolvedValue(undefined);
    const mpListUnhandled = jest.fn().mockResolvedValue([]);
    const mpObservePosting = jest.fn().mockResolvedValue(null);
    const mpHandleDelivered = jest.fn().mockResolvedValue(undefined);
    const mpSalesEnabled = jest.fn().mockReturnValue(false);
    const mpFlush = jest.fn().mockResolvedValue(undefined);
    const isExists = jest.fn();
    const pickupInvoice = jest.fn();
    const getTransaction = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const updatePrim = jest.fn();
    const getByPosting = jest.fn();
    const getAttachedMarkCodesByScode = jest.fn();
    const getKmFullByKi = jest.fn();
    const findFboPodbposCandidates = jest.fn();
    const findRealpriceCodes = jest.fn();
    const findLiveMigratableCodes = jest.fn();
    const migrateMarkCode = jest.fn();
    const migratePodbpos = jest.fn();
    const clearInvoiceReserve = jest.fn();
    const getStorageSS = jest.fn();
    let markCodesEnabled = false;
    let servicesEnabled: string[] = [GoodServiceEnum.WB];
    const fetchSalesByStickerExecute = jest.fn();
    const fetchOrdersByStickerExecute = jest.fn();
    const fetchTransactionsExecute = jest.fn();
    const selectBestIdExecute = jest.fn();
    const fetchInvoiceByRemarkExecute = jest.fn();
    const processedCacheLoad = jest.fn();
    const processedCacheSave = jest.fn();
    const fboCreate = jest.fn();
    getTransaction.mockResolvedValue({ commit, rollback });

    beforeEach(async () => {
        // Clear rate limit cache before each test to prevent timeouts
        clearRateLimitCache();
        markCodesEnabled = false;
        servicesEnabled = [GoodServiceEnum.WB];
        getStorageSS.mockReturnValue(1);
        [
            findFboPodbposCandidates,
            findRealpriceCodes,
            findLiveMigratableCodes,
            migrateMarkCode,
            migratePodbpos,
            clearInvoiceReserve,
        ].forEach((m) => m.mockReset());
        findLiveMigratableCodes.mockResolvedValue([]);
        migratePodbpos.mockResolvedValue(undefined);
        clearInvoiceReserve.mockResolvedValue(undefined);

        module = await Test.createTestingModule({
            providers: [
                WbOrderService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        createInvoiceFromPostingDto,
                        updateByCommissions,
                        isExists,
                        pickupInvoice,
                        getTransaction,
                        updatePrim,
                        getByPosting,
                        getAttachedMarkCodesByScode,
                        getKmFullByKi,
                        findFboPodbposCandidates,
                        findRealpriceCodes,
                        findLiveMigratableCodes,
                        migrateMarkCode,
                        migratePodbpos,
                        clearInvoiceReserve,
                        getStorageSS,
                    },
                },
                {
                    provide: WbApiService,
                    useValue: { method },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string) => {
                            if (key === 'MARK_CODES_ENABLED') return markCodesEnabled;
                            if (key === 'SERVICES') return servicesEnabled;
                            return 123456;
                        },
                    },
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
                {
                    provide: ProcessedCacheService,
                    useValue: { load: processedCacheLoad, save: processedCacheSave, process: jest.fn() },
                },
                {
                    provide: FboInvoiceCreatorService,
                    useValue: { create: fboCreate },
                },
                {
                    provide: WbCustomerService,
                    useValue: { getClaims: getClaims },
                },
                {
                    provide: MpEventService,
                    useValue: {
                        record: mpRecord,
                        firstSeen: mpFirstSeen,
                        isHandled: mpIsHandled,
                        markHandled: mpMarkHandled,
                        listUnhandled: mpListUnhandled,
                    },
                },
                {
                    provide: MpDecisionRunnerService,
                    useValue: {
                        observePosting: mpObservePosting,
                        handleDelivered: mpHandleDelivered,
                        salesEnabled: mpSalesEnabled,
                        flush: mpFlush,
                    },
                },
            ],
        }).compile();
        method.mockClear();
        createInvoiceFromPostingDto.mockClear();
        commit.mockClear();
        isExists.mockClear();
        updatePrim.mockClear();
        processedCacheLoad.mockReset().mockImplementation(async () => new Set<string>());
        processedCacheSave.mockReset().mockResolvedValue(undefined);
        fboCreate.mockReset();
        getByPosting.mockClear();
        getAttachedMarkCodesByScode.mockReset();
        getKmFullByKi.mockReset();
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

    it('list returns empty array on 429 error', async () => {
        method.mockResolvedValueOnce({
            error: { status: 429, retryAfterMs: 60000 },
            result: null,
            status: 'NotOk',
        });
        const result = await service.list();
        expect(result).toEqual([]);
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
                service: GoodServiceEnum.WB,
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
                service: GoodServiceEnum.WB,
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

    it.each([
        ['204 No Content (пустая строка)', ''],
        ['undefined', undefined],
        ['null', null],
    ])('getTransactions returns [] when WB responds with %s', async (_label, value) => {
        method.mockResolvedValueOnce(value);
        const date = new Date();
        const result = await service.getTransactions({ from: date, to: date });
        expect(result).toEqual([]);
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

    it('addFboOrders: новый srid → creator создаёт счёт (WB-контекст), помечен обработанным', async () => {
        method
            .mockResolvedValueOnce([
                { srid: '1' },
                { srid: '2' },
                { srid: '3', totalPrice: 112, supplierArticle: '111', date: '2011-11-11' },
                { srid: '6', totalPrice: 112, supplierArticle: '111', date: '2011-11-11', isCancel: true },
            ])
            .mockResolvedValueOnce({ orders: [{ rid: '2' }, { rid: '4' }, { rid: '5' }] });
        isExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        fboCreate.mockResolvedValueOnce({ id: 1 });

        await service.addFboOrders();

        expect(fboCreate).toHaveBeenCalledTimes(1);
        const ctx = fboCreate.mock.calls[0][0];
        expect(ctx.service).toBe(GoodServiceEnum.WB);
        expect(ctx.prims).toEqual(['WBFBO']);
        expect(ctx.primLabel).toBe('WBFBO');
        expect(ctx.buyerId).toBe(123456);
        expect(ctx.useMigration).toBe(false);
        expect(ctx.setIgkNot1c).toBe(false);
        expect(ctx.pickupAfterCreate).toBe(true);
        expect(ctx.skipIfNoPodbor).toBe(true);
        expect(ctx.posting.posting_number).toBe('3');
        expect(ctx.posting.products).toEqual([{ offer_id: '111', price: '112', quantity: 1 }]);
        expect(commit.mock.calls).toHaveLength(1);
        // srid '3' помечен обработанным и сохранён после commit
        expect(processedCacheSave).toHaveBeenCalledWith('fbo-orders', 'WbOrderService', new Set(['3']));
    });

    it('addFboOrders: недостача/«левый» заказ (creator вернул null) → не помечаем обработанным', async () => {
        method
            .mockResolvedValueOnce([
                { srid: '3', totalPrice: 112, supplierArticle: '111', date: '2011-11-11' },
            ])
            .mockResolvedValueOnce({ orders: [] });
        isExists.mockResolvedValueOnce(false);
        fboCreate.mockResolvedValueOnce(null);

        await service.addFboOrders();

        expect(fboCreate).toHaveBeenCalledTimes(1);
        // null → заказ НЕ уходит в processed (недостача глушится журналом, «левый» — перепроверится)
        expect(processedCacheSave).toHaveBeenCalledWith('fbo-orders', 'WbOrderService', new Set<string>());
    });

    it('addFboOrders: srid уже в кеше → creator не вызывается', async () => {
        processedCacheLoad.mockImplementationOnce(async () => new Set(['3']));
        method
            .mockResolvedValueOnce([
                { srid: '3', totalPrice: 112, supplierArticle: '111', date: '2011-11-11' },
            ])
            .mockResolvedValueOnce({ orders: [] });
        isExists.mockResolvedValue(false);

        await service.addFboOrders();

        expect(fboCreate).not.toHaveBeenCalled();
    });

    it('addFboOrders: wh-service-podmena пропускается до creator', async () => {
        method
            .mockResolvedValueOnce([
                { srid: '3', totalPrice: 100, supplierArticle: 'wh-service-podmena', date: '2026-01-01' },
            ])
            .mockResolvedValueOnce({ orders: [] });
        isExists.mockResolvedValueOnce(false);

        await service.addFboOrders();

        expect(fboCreate).not.toHaveBeenCalled();
    });

    it('addFboOrders: migration flag → useMigration=true в контексте', async () => {
        markCodesEnabled = true;
        method
            .mockResolvedValueOnce([
                { srid: '3', totalPrice: 100, supplierArticle: '111', date: '2026-01-01' },
            ])
            .mockResolvedValueOnce({ orders: [] });
        isExists.mockResolvedValueOnce(false);
        fboCreate.mockResolvedValueOnce({ id: 999 });

        await service.addFboOrders();

        expect(fboCreate.mock.calls[0][0].useMigration).toBe(true);
        expect(emit).toHaveBeenCalledWith(
            'wb.order.content',
            'Добавлены WB FBO заказы',
            [{ prim: '3', offer_id: '111' }],
        );
    });

    // Defensive regression: commit на happy path, rollback на любой ошибке creator.
    it('addFboOrders: creator упал → rollback, commit НЕ вызывается, return false', async () => {
        method
            .mockResolvedValueOnce([
                { srid: '3', totalPrice: 100, supplierArticle: '111', date: '2026-01-01' },
            ])
            .mockResolvedValueOnce({ orders: [] });
        isExists.mockResolvedValueOnce(false);
        fboCreate.mockRejectedValueOnce(new Error('DB lock'));
        rollback.mockClear();
        commit.mockClear();
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

        const ok = await service.addFboOrders();

        expect(ok).toBe(false);
        expect(rollback).toHaveBeenCalledWith(true);
        expect(commit).not.toHaveBeenCalled();
        logSpy.mockRestore();
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
        isExists.mockResolvedValueOnce(true);
        await service.checkCanceledOrders();
        // srid 2 и 4 матчатся с FBS-заказами (rid) — их ведёт конвейер cancelOrders,
        // легаси обрабатывает только чистые FBO; суффикс — из единого объекта.
        expect(isExists.mock.calls).toHaveLength(1);
        expect(updatePrim.mock.calls).toHaveLength(1);
        expect(updatePrim.mock.calls[0]).toEqual(['1', '1 отмена WBFBO', null]);
        // обработанные prim сохранены в кеш
        expect(processedCacheSave).toHaveBeenCalledWith(
            'fbo-cancellations', 'WbOrderService', new Set(['1']),
        );
    });

    it('checkCanceledOrders: prim уже в кеше → updatePrim не вызывается', async () => {
        processedCacheLoad.mockImplementationOnce(async () => new Set(['1']));
        method
            .mockResolvedValueOnce([{ srid: '1', isCancel: true, date: '2019-11-11' }])
            .mockResolvedValueOnce({ orders: [] });

        await service.checkCanceledOrders();

        expect(isExists).not.toHaveBeenCalled();
        expect(updatePrim).not.toHaveBeenCalled();
        expect(processedCacheSave).toHaveBeenCalledWith(
            'fbo-cancellations', 'WbOrderService', new Set(['1']),
        );
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
            service: GoodServiceEnum.WB,
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

    it('getInvoiceBySrid should find invoice directly by srid', async () => {
        const mockInvoice = {
            id: 456,
            buyerId: 789,
            number: 2,
            status: 1,
            remark: 'WB 6002',
            date: new Date(),
        };

        // Моки для команд (без sales/orders)
        fetchTransactionsExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, transactions: [{ assembly_id: 6002 }] })
        );
        selectBestIdExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, selectedId: '6002', selectedIdType: 'assembly_id' })
        );
        fetchInvoiceByRemarkExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, invoice: mockInvoice })
        );

        const result = await service.getInvoiceBySrid({
            dateFrom: '2025-09-21',
            srid: 'SRID-TEST-123',
        });

        expect(result).toEqual(mockInvoice);
        // Проверяем, что sales/orders НЕ вызывались
        expect(fetchSalesByStickerExecute).not.toHaveBeenCalled();
        expect(fetchOrdersByStickerExecute).not.toHaveBeenCalled();
        // Проверяем, что транзакции искались
        expect(fetchTransactionsExecute).toHaveBeenCalled();
        expect(selectBestIdExecute).toHaveBeenCalled();
        expect(fetchInvoiceByRemarkExecute).toHaveBeenCalled();
    });

    it('getInvoiceBySrid should return null if not found', async () => {
        // Моки для команд - ничего не находим
        fetchTransactionsExecute.mockImplementationOnce((ctx) =>
            Promise.resolve({ ...ctx, stopChain: true })
        );

        const result = await service.getInvoiceBySrid({
            dateFrom: '2025-09-21',
            srid: 'UNKNOWN-SRID',
        });

        expect(result).toBeNull();
        expect(fetchSalesByStickerExecute).not.toHaveBeenCalled();
        expect(fetchOrdersByStickerExecute).not.toHaveBeenCalled();
    });

    describe('submitFbsMarkCodes', () => {
        const invoice = { id: 8344, remark: '592715', buyerId: 123456 } as any;

        it('возвращает ok=true если нет привязанных КМ', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([]);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true });
            expect(method).not.toHaveBeenCalled();
        });

        it('некорректный orderId → skipRetry=true', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
            ]);
            const res = await service.submitFbsMarkCodes({ ...invoice, remark: 'NOT-A-NUMBER' });
            expect(res.ok).toBe(false);
            expect(res.skipRetry).toBe(true);
            expect(method).not.toHaveBeenCalled();
        });

        it('не делает GET /meta (его нет в API v3), сразу PUT sgtin', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-1');
            method.mockResolvedValueOnce({});

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res).toEqual({ ok: true });
            expect(method).toHaveBeenCalledTimes(1);
            expect(method).toHaveBeenCalledWith('/api/v3/orders/592715/meta/sgtin', 'put', {
                sgtins: ['01FULL-1'],
            });
        });

        it('happy path: attached КМ → setOrderKiz (PUT sgtin)', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
                { ki: 'KI-2', goodscode: '531557', realpricecode: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-1').mockResolvedValueOnce('01FULL-2');
            method.mockResolvedValueOnce({});

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res).toEqual({ ok: true });
            expect(method).toHaveBeenCalledWith('/api/v3/orders/592715/meta/sgtin', 'put', {
                sgtins: ['01FULL-1', '01FULL-2'],
            });
        });

        it('PUT вернул NotOk → ok=false без skipRetry (крон повторит)', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-1');
            method.mockResolvedValueOnce({
                status: 'NotOk',
                error: { status: 405, message: 'method not allowed' },
            });

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.skipRetry).toBeUndefined();
            expect(res.failed?.[0]?.reason).toContain('405');
        });

        it('часть KM_FULL пуста → ok=false с failed для пустых', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
                { ki: 'KI-2', goodscode: '531557', realpricecode: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-1').mockResolvedValueOnce(null);
            method.mockResolvedValueOnce({});

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.failed).toEqual([{ ki: 'KI-2', reason: 'KM_FULL пуст' }]);
            expect(method).toHaveBeenCalledWith('/api/v3/orders/592715/meta/sgtin', 'put', {
                sgtins: ['01FULL-1'],
            });
        });

        it('все KM_FULL пусты → ok=false, PUT не вызывается', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce(null);

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.failed).toEqual([{ ki: 'KI-1', reason: 'KM_FULL пуст' }]);
            expect(method).not.toHaveBeenCalled();
        });

        it('>100 КМ → skipRetry=true, PUT не вызывается', async () => {
            const many = Array.from({ length: 101 }, (_, i) => ({
                ki: `KI-${i}`,
                goodscode: '531557',
                realpricecode: 1,
            }));
            getAttachedMarkCodesByScode.mockResolvedValueOnce(many);
            getKmFullByKi.mockImplementation((ki: string) => Promise.resolve(`01FULL-${ki}`));

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.skipRetry).toBe(true);
            expect(res.failed?.[0]?.reason).toContain('>100 КМ');
            expect(method).not.toHaveBeenCalled();
        });
    });

    describe('наблюдатель observeWbFbs и отмены listCanceled (план ВБ)', () => {
        const ordersPage = (orders: any[]) => ({ orders, next: 0 });

        beforeEach(() => {
            mpRecord.mockReset().mockResolvedValue(true);
            mpFirstSeen.mockReset().mockResolvedValue(null);
            mpListUnhandled.mockReset().mockResolvedValue([]);
            mpObservePosting.mockReset().mockResolvedValue(null);
            mpHandleDelivered.mockReset().mockResolvedValue(undefined);
            mpSalesEnabled.mockReset().mockReturnValue(false);
            mpFlush.mockReset().mockResolvedValue(undefined);
            getClaims.mockReset().mockResolvedValue({ claims: [], total: 0 });
        });

        it('гейт SERVICES: без ВБ в конфиге наблюдатель не ходит в API', async () => {
            servicesEnabled = ['ozon'];

            await service.observeWbFbs();

            expect(method).not.toHaveBeenCalled();
            expect(mpFlush).not.toHaveBeenCalled();
        });

        it('sold при включённых продажах → журнал + общий handleDelivered; отмена → наблюдение с shipped и WB', async () => {
            mpSalesEnabled.mockReturnValue(true);
            method
                .mockResolvedValueOnce(
                    ordersPage([
                        { id: 101, createdAt: '2026-08-10', article: 'a1', convertedPrice: 100, rid: 'r101' },
                        { id: 102, createdAt: '2026-08-01', article: 'a2', convertedPrice: 200, rid: 'r102' },
                    ]),
                )
                .mockResolvedValueOnce({
                    orders: [
                        { id: 101, supplierStatus: 'complete', wbStatus: 'sold' },
                        { id: 102, supplierStatus: 'complete', wbStatus: 'canceled' },
                    ],
                });

            await service.observeWbFbs();

            expect(mpRecord).toHaveBeenCalledWith(
                expect.objectContaining({ service: 'WB', kind: 'POSTING_FBS', extId: '101', state: 'delivered' }),
            );
            expect(mpHandleDelivered).toHaveBeenCalledWith(
                expect.objectContaining({ extId: '101', state: 'delivered' }),
            );
            // отмена: наблюдение решающей таблицей, отгрузка из supplierStatus, сервис WB
            expect(mpObservePosting).toHaveBeenCalledWith('102', 'FBS', 'cancel', true, 'WB');
            expect(mpFlush).toHaveBeenCalledWith('observeWbFbs');
        });

        it('добор из журнала: осевший sold исполняется даже без заказа в окне', async () => {
            mpSalesEnabled.mockReturnValue(true);
            method.mockResolvedValueOnce(ordersPage([]));
            mpListUnhandled.mockResolvedValueOnce([{ extId: '99', posting: '99', firstSeen: new Date() }]);

            await service.observeWbFbs();

            expect(mpListUnhandled).toHaveBeenCalledWith('WB', 'POSTING_FBS', 'delivered');
            expect(mpHandleDelivered).toHaveBeenCalledWith(
                expect.objectContaining({ service: 'WB', extId: '99', state: 'delivered' }),
            );
        });

        it('listCanceled: до первого посева наблюдателем действий нет вовсе', async () => {
            mpFirstSeen.mockResolvedValue(null); // маркера посева нет

            const res = await service.listCanceled();

            expect(res).toEqual([]);
            expect(method).not.toHaveBeenCalled(); // в API за заказами не ходим
            expect(mpRecord).not.toHaveBeenCalled(); // журнал только читаем
        });

        it('listCanceled: живая отмена в выборке, хвост до посева и старая — отфильтрованы', async () => {
            const day = 24 * 3600 * 1000;
            const seededAt = new Date(Date.now() - 8 * day);
            method
                .mockResolvedValueOnce(
                    ordersPage([
                        { id: 201, createdAt: '2026-07-01', article: 'a1', convertedPrice: 100, rid: 'r201' },
                        { id: 202, createdAt: '2026-07-01', article: 'a2', convertedPrice: 200, rid: 'r202' },
                        { id: 203, createdAt: '2026-07-01', article: 'a3', convertedPrice: 300, rid: 'r203' },
                    ]),
                )
                .mockResolvedValueOnce({
                    orders: [
                        { id: 201, supplierStatus: 'complete', wbStatus: 'canceled_by_client' },
                        { id: 202, supplierStatus: 'complete', wbStatus: 'canceled' },
                        { id: 203, supplierStatus: 'complete', wbStatus: 'canceled' },
                    ],
                });
            // 201 — живая (вчера), 202 — хвост (посеяна вместе с маркером),
            // 203 — позже посева, но старше окна действий (7 дней) — только наблюдение.
            mpFirstSeen.mockImplementation(async (ev: any) => {
                if (ev.extId === '__OBSERVE_SEED__') return seededAt;
                if (ev.extId === '201') return new Date(Date.now() - 1 * day);
                if (ev.extId === '202') return seededAt;
                return new Date(Date.now() - 7.5 * day);
            });

            const res = await service.listCanceled();

            expect(res).toHaveLength(1);
            expect(res[0]).toEqual(
                expect.objectContaining({
                    posting_number: '201',
                    status: 'canceled_by_client',
                    service: GoodServiceEnum.WB,
                    shipped: true,
                }),
            );
            expect(mpRecord).not.toHaveBeenCalled(); // журнал пишет только наблюдатель
        });

        it('наблюдатель после полного посева ставит маркер', async () => {
            method.mockResolvedValueOnce(ordersPage([]));

            await service.observeWbFbs();

            expect(mpRecord).toHaveBeenCalledWith(
                expect.objectContaining({ extId: '__OBSERVE_SEED__', state: 'seeded' }),
            );
        });
    });

    describe('возвраты после выкупа listReturns (IReturnable)', () => {
        beforeEach(() => {
            getClaims.mockReset();
            method.mockClear();
        });

        it('заявка матчится по srid → номер задания, состояние нормализовано', async () => {
            getClaims
                .mockResolvedValueOnce({
                    claims: [{ id: 'uuid-1', status: 2, status_ex: 8, srid: 'sr-1', order_dt: '2026-08-01T10:00:00' }],
                    total: 1,
                })
                .mockResolvedValueOnce({ claims: [], total: 0 });
            method.mockResolvedValueOnce({
                orders: [{ id: 301, createdAt: '2026-08-01', article: 'a1', convertedPrice: 100, rid: 'sr-1' }],
                next: 0,
            });

            const res = await service.listReturns();

            expect(res).toHaveLength(1);
            expect(res[0]).toEqual(
                expect.objectContaining({
                    id: 'uuid-1',
                    posting_number: '301',
                    schema: 'Fbs',
                    visual: { status: expect.objectContaining({ sys_name: 'ReturnedToOzon' }) },
                }),
            );
        });

        it('заявка на рассмотрении события не порождает; несматченная — пропускается', async () => {
            getClaims
                .mockResolvedValueOnce({
                    claims: [
                        { id: 'uuid-2', status: 0, status_ex: 0, srid: 'sr-2', order_dt: '2026-08-01T10:00:00' },
                        { id: 'uuid-3', status: 2, status_ex: 10, srid: 'sr-NEMATCH', order_dt: '2026-08-01T10:00:00' },
                    ],
                    total: 2,
                })
                .mockResolvedValueOnce({ claims: [], total: 0 });
            method.mockResolvedValueOnce({ orders: [], next: 0 });

            const res = await service.listReturns();

            expect(res).toEqual([]);
        });

        it('заявок нет → в заказы не ходим', async () => {
            getClaims.mockResolvedValue({ claims: [], total: 0 });

            const res = await service.listReturns();

            expect(res).toEqual([]);
            expect(method).not.toHaveBeenCalled();
        });

        it('returnCounts всегда undefined: одно задание = одна единица, частичности нет', async () => {
            expect(await service.returnCounts({} as any)).toBeUndefined();
        });
    });
});
