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
import { FboMarkMigrationService } from '../posting.fbo/fbo-mark-migration.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
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
    const rollback = jest.fn();
    const updatePrim = jest.fn();
    const getByPosting = jest.fn();
    const getAttachedMarkCodesByScode = jest.fn();
    const getKmFullByKi = jest.fn();
    const findFboPodbposCandidates = jest.fn();
    const findRealpriceCodes = jest.fn();
    const getAttachedMarkCodesForMigration = jest.fn();
    const detachMarkCode = jest.fn();
    const decrementPodbpos = jest.fn();
    const reattachMarkCodeTransferred = jest.fn();
    const getStorageSS = jest.fn();
    let markCodesEnabled = false;
    const fetchSalesByStickerExecute = jest.fn();
    const fetchOrdersByStickerExecute = jest.fn();
    const fetchTransactionsExecute = jest.fn();
    const selectBestIdExecute = jest.fn();
    const fetchInvoiceByRemarkExecute = jest.fn();
    const processedCacheLoad = jest.fn();
    const processedCacheSave = jest.fn();
    getTransaction.mockResolvedValue({ commit, rollback });

    beforeEach(async () => {
        // Clear rate limit cache before each test to prevent timeouts
        clearRateLimitCache();
        markCodesEnabled = false;
        getStorageSS.mockReturnValue(1);
        [
            findFboPodbposCandidates,
            findRealpriceCodes,
            getAttachedMarkCodesForMigration,
            detachMarkCode,
            decrementPodbpos,
            reattachMarkCodeTransferred,
        ].forEach((m) => m.mockReset());

        module = await Test.createTestingModule({
            providers: [
                WbOrderService,
                FboMarkMigrationService,
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
                        getAttachedMarkCodesByScode,
                        getKmFullByKi,
                        findFboPodbposCandidates,
                        findRealpriceCodes,
                        getAttachedMarkCodesForMigration,
                        detachMarkCode,
                        decrementPodbpos,
                        reattachMarkCodeTransferred,
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
            ],
        }).compile();
        method.mockClear();
        createInvoiceFromPostingDto.mockClear();
        commit.mockClear();
        isExists.mockClear();
        unPickupOzonFbo.mockClear();
        updatePrim.mockClear();
        processedCacheLoad.mockReset().mockImplementation(async () => new Set<string>());
        processedCacheSave.mockReset().mockResolvedValue(undefined);
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
            { commit, rollback },
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
            { commit, rollback },
        ]);
        expect(pickupInvoice.mock.calls[0]).toEqual(['invoice', { commit, rollback }]);
        expect(commit.mock.calls).toHaveLength(1);
        // srid '3' помечен обработанным и сохранён после commit
        expect(processedCacheSave).toHaveBeenCalledWith('fbo-orders', 'WbOrderService', new Set(['3']));
    });

    it('addFboOrders: srid уже в кеше → invoice не создаётся', async () => {
        processedCacheLoad.mockImplementationOnce(async () => new Set(['3']));
        method
            .mockResolvedValueOnce([
                { srid: '3', totalPrice: 112, supplierArticle: '111', date: '2011-11-11' },
            ])
            .mockResolvedValueOnce({ orders: [] });
        isExists.mockResolvedValue(false);

        await service.addFboOrders();

        expect(createInvoiceFromPostingDto).not.toHaveBeenCalled();
        expect(unPickupOzonFbo).not.toHaveBeenCalled();
        expect(processedCacheSave).toHaveBeenCalledWith('fbo-orders', 'WbOrderService', new Set(['3']));
    });

    describe('addFboOrders — mark migration (flag on)', () => {
        beforeEach(() => {
            markCodesEnabled = true;
            unPickupOzonFbo.mockReset();
            pickupInvoice.mockReset();
            createInvoiceFromPostingDto.mockReset();
            isExists.mockReset();
            commit.mockClear();
            emit.mockClear();
        });

        const mockOrders = () => {
            method
                .mockResolvedValueOnce([
                    { srid: '3', totalPrice: 100, supplierArticle: '111', date: '2026-01-01' },
                ])
                .mockResolvedValueOnce({ orders: [] });
        };

        it('кандидатов нет → continue, invoice не создан, миграция не вызвана', async () => {
            mockOrders();
            isExists.mockResolvedValueOnce(false);
            findFboPodbposCandidates.mockResolvedValueOnce([]);

            const ok = await service.addFboOrders();

            expect(ok).toBe(true);
            expect(findFboPodbposCandidates.mock.calls[0]).toEqual([
                '111', ['WBFBO'], { commit, rollback },
            ]);
            expect(createInvoiceFromPostingDto).not.toHaveBeenCalled();
            expect(unPickupOzonFbo).not.toHaveBeenCalled();
            expect(pickupInvoice).not.toHaveBeenCalled();
            expect(detachMarkCode).not.toHaveBeenCalled();
            expect(reattachMarkCodeTransferred).not.toHaveBeenCalled();
            expect(emit).not.toHaveBeenCalled();
        });

        it('happy path: кандидат → createInvoice → migrate (DETACH/REATTACH) → pickupInvoice → emit', async () => {
            mockOrders();
            isExists.mockResolvedValueOnce(false);
            // findFboPodbposCandidates зовётся дважды: 1) pre-check в WbOrderService, 2) внутри migrate
            const cand = { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'WBFBO' };
            findFboPodbposCandidates
                .mockResolvedValueOnce([cand])
                .mockResolvedValueOnce([cand]);
            createInvoiceFromPostingDto.mockResolvedValueOnce({ id: 999 });
            findRealpriceCodes.mockResolvedValueOnce([300]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'K1' }]);

            await service.addFboOrders();

            expect(createInvoiceFromPostingDto).toHaveBeenCalledTimes(1);
            expect(createInvoiceFromPostingDto.mock.calls[0][0]).toBe(123456);
            expect(createInvoiceFromPostingDto.mock.calls[0][1].posting_number).toBe('3');
            expect(findRealpriceCodes).toHaveBeenCalledWith(999, { commit, rollback });
            expect(detachMarkCode).toHaveBeenCalledWith('K1', 100, 1, { commit, rollback });
            expect(decrementPodbpos).toHaveBeenCalledWith(1001, 1, { commit, rollback });
            expect(reattachMarkCodeTransferred).toHaveBeenCalledWith('K1', 300, '111', 1, { commit, rollback });
            expect(pickupInvoice).toHaveBeenCalledWith({ id: 999 }, { commit, rollback });
            expect(unPickupOzonFbo).not.toHaveBeenCalled();
            expect(emit).toHaveBeenCalledWith(
                'wb.order.content',
                'Добавлены WB FBO заказы',
                [{ prim: '3', offer_id: '111' }],
            );
        });

        it('pre-check видит кандидата, а migrate уже нет (race) → warn в лог, не падаем', async () => {
            mockOrders();
            isExists.mockResolvedValueOnce(false);
            // 1-й вызов из pre-check — кандидат есть; 2-й из migrate — пусто
            findFboPodbposCandidates
                .mockResolvedValueOnce([
                    { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'WBFBO' },
                ])
                .mockResolvedValueOnce([]);
            createInvoiceFromPostingDto.mockResolvedValueOnce({ id: 999 });
            findRealpriceCodes.mockResolvedValueOnce([300]);
            const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

            const ok = await service.addFboOrders();

            expect(ok).toBe(true);
            expect(warnSpy).toHaveBeenCalled();
            expect(warnSpy.mock.calls[0][0]).toContain('WB FBO migration: unexpected shortage on 3');
            expect(pickupInvoice).toHaveBeenCalledWith({ id: 999 }, { commit, rollback });
            warnSpy.mockRestore();
        });

        it('wh-service-podmena всегда пропускается до checkов миграции', async () => {
            method
                .mockResolvedValueOnce([
                    { srid: '3', totalPrice: 100, supplierArticle: 'wh-service-podmena', date: '2026-01-01' },
                ])
                .mockResolvedValueOnce({ orders: [] });
            isExists.mockResolvedValueOnce(false);

            await service.addFboOrders();

            expect(findFboPodbposCandidates).not.toHaveBeenCalled();
            expect(createInvoiceFromPostingDto).not.toHaveBeenCalled();
        });

        // Defensive regression tests: транзакция должна commit'ится на happy path и rollback'аться
        // на любой ошибке. Защита от случайной правки try/catch вокруг цикла или удаления rollback.
        it('happy path: транзакция commit (rollback НЕ вызывался)', async () => {
            mockOrders();
            isExists.mockResolvedValueOnce(false);
            const cand = { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'WBFBO' };
            findFboPodbposCandidates
                .mockResolvedValueOnce([cand])
                .mockResolvedValueOnce([cand]);
            createInvoiceFromPostingDto.mockResolvedValueOnce({ id: 999 });
            findRealpriceCodes.mockResolvedValueOnce([300]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'K1' }]);
            rollback.mockClear();
            commit.mockClear();

            const ok = await service.addFboOrders();

            expect(ok).toBe(true);
            expect(commit).toHaveBeenCalledTimes(1);
            expect(rollback).not.toHaveBeenCalled();
        });

        it('ошибка внутри migrate → rollback вызывается, commit НЕ вызывается, return false', async () => {
            mockOrders();
            isExists.mockResolvedValueOnce(false);
            const cand = { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'WBFBO' };
            findFboPodbposCandidates
                .mockResolvedValueOnce([cand])
                .mockResolvedValueOnce([cand]);
            createInvoiceFromPostingDto.mockResolvedValueOnce({ id: 999 });
            findRealpriceCodes.mockResolvedValueOnce([300]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'K1' }]);
            // detach падает внутри миграции
            detachMarkCode.mockRejectedValueOnce(new Error('DB lock'));
            rollback.mockClear();
            commit.mockClear();
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

            const ok = await service.addFboOrders();

            expect(ok).toBe(false);
            expect(rollback).toHaveBeenCalledWith(true);
            expect(commit).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });
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
        // обработанные prim сохранены в кеш
        expect(processedCacheSave).toHaveBeenCalledWith(
            'fbo-cancellations', 'WbOrderService', new Set(['1', '14']),
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

        it('meta без sgtin → skipped', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
            ]);
            method.mockResolvedValueOnce({ meta: {}, requiredMeta: [], optionalMeta: ['gtin'] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, skipped: 'no sgtin required' });
            expect(method).toHaveBeenCalledTimes(1);
            expect(method).toHaveBeenCalledWith('/api/v3/orders/592715/meta', 'get', {});
        });

        it('happy path: meta(requires sgtin) → setOrderKiz', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
                { ki: 'KI-2', goodscode: '531557', realpricecode: 1 },
            ]);
            method.mockResolvedValueOnce({ meta: {}, requiredMeta: ['sgtin'] });
            getKmFullByKi.mockResolvedValueOnce('01FULL-1').mockResolvedValueOnce('01FULL-2');
            method.mockResolvedValueOnce({});

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res).toEqual({ ok: true });
            expect(method).toHaveBeenNthCalledWith(2, '/api/v3/orders/592715/meta/sgtin', 'put', {
                sgtins: ['01FULL-1', '01FULL-2'],
            });
        });

        it('часть KM_FULL пуста → ok=true с failed для пустых', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
                { ki: 'KI-2', goodscode: '531557', realpricecode: 1 },
            ]);
            method.mockResolvedValueOnce({ meta: {}, optionalMeta: ['sgtin'] });
            getKmFullByKi.mockResolvedValueOnce('01FULL-1').mockResolvedValueOnce(null);
            method.mockResolvedValueOnce({});

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.failed).toEqual([{ ki: 'KI-2', reason: 'KM_FULL пуст' }]);
            expect(method).toHaveBeenNthCalledWith(2, '/api/v3/orders/592715/meta/sgtin', 'put', {
                sgtins: ['01FULL-1'],
            });
        });

        it('все KM_FULL пусты → ok=false, setOrderKiz не вызывается', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1 },
            ]);
            method.mockResolvedValueOnce({ meta: {}, requiredMeta: ['sgtin'] });
            getKmFullByKi.mockResolvedValueOnce(null);

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.failed).toEqual([{ ki: 'KI-1', reason: 'KM_FULL пуст' }]);
            expect(method).toHaveBeenCalledTimes(1);
        });

        it('>100 КМ → skipRetry=true, без вызова setOrderKiz', async () => {
            const many = Array.from({ length: 101 }, (_, i) => ({
                ki: `KI-${i}`,
                goodscode: '531557',
                realpricecode: 1,
            }));
            getAttachedMarkCodesByScode.mockResolvedValueOnce(many);
            method.mockResolvedValueOnce({ meta: {}, requiredMeta: ['sgtin'] });
            getKmFullByKi.mockImplementation((ki: string) => Promise.resolve(`01FULL-${ki}`));

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.skipRetry).toBe(true);
            expect(res.failed?.[0]?.reason).toContain('>100 КМ');
            expect(method).toHaveBeenCalledTimes(1);
        });
    });
});