import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';
import { ProductService } from '../product/product.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { PostingService } from '../posting/posting.service';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { WbCustomerService } from '../wb.customer/wb.customer.service';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { AccrualWeekService } from '../trade2006.accrual/accrual.week.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('OrderService', () => {
    let service: OrderService;
    const runWeek = jest.fn();
    const updateByTransactions = jest.fn();
    const createInvoice = jest.fn().mockResolvedValue(1);
    const getByPosting = jest.fn()
        .mockResolvedValueOnce({
            posting_number: '111',
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(2);
    const updatePrim = jest.fn();
    const pickupInvoice = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const getTransaction = () => ({ commit, rollback });
    const date = new Date();
    const cacheGet = jest.fn().mockResolvedValue('');
    const cacheSet = jest.fn().mockResolvedValue(undefined);
    const eventEmitterEmit = jest.fn();
    const listFbsAwaitingShip = jest.fn().mockResolvedValue([]);
    const ozonSubmitFbsMarkCodes = jest.fn();
    const wbSubmitFbsMarkCodes = jest.fn();
    let nodeEnv = 'development';
    let markCodesEnabled = false;
    beforeEach(async () => {
        nodeEnv = 'development';
        markCodesEnabled = false;
        commit.mockReset();
        rollback.mockReset();
        createInvoice.mockClear();
        listFbsAwaitingShip.mockReset().mockResolvedValue([]);
        ozonSubmitFbsMarkCodes.mockReset();
        wbSubmitFbsMarkCodes.mockReset();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: AccrualWeekService, useValue: { runWeek } },
                OrderService,
                { provide: ProductService, useValue: {} },
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        getTransaction,
                        updateByTransactions,
                        getByPosting,
                        pickupInvoice,
                        updatePrim,
                        update: jest.fn(),
                        isExists: async (remark: string) => remark === '123' || remark === '111',
                        // предикат вместо булева isExists: те же номера, но с пометкой счёта
                        findByPosting: async (posting: any) => {
                            const remark = typeof posting === 'string' ? posting : posting.posting_number;
                            return remark === '123' || remark === '111'
                                ? { invoice: { id: 1, status: 3, remark }, mark: '', cancelled: false, closed: false }
                                : null;
                        },
                        listFbsAwaitingShip,
                    },
                },
                {
                    provide: PostingService,
                    useValue: {
                        constructor: { name: 'PostingService' },
                        createInvoice,
                        submitFbsMarkCodes: ozonSubmitFbsMarkCodes,
                        getBuyerId: () => 11,
                        isFbo: () => false,
                        listReturns: jest.fn().mockResolvedValue([]),
                        listAwaitingPackaging: () => [
                            {
                                posting_number: '123',
                                status: 'awaiting_packaging',
                                in_process_at: date,
                                products: [],
                            },
                            {
                                posting_number: '321',
                                status: 'awaiting_packaging',
                                in_process_at: date,
                                products: [{ price: '1.11', offer_id: '444', quantity: 2 }],
                            },
                        ],
                        listAwaitingDelivering: () => [
                            {
                                posting_number: '123',
                                status: 'awaiting_packaging',
                                in_process_at: date,
                                products: [],
                            },
                            {
                                posting_number: '123',
                                status: 'awaiting_packaging',
                                in_process_at: date,
                                products: [],
                            },
                        ],
                        listCanceled: () => [
                            {
                                posting_number: '111',
                                status: 'canceled',
                                in_process_at: date,
                                products: [{ price: '1.11', offer_id: '444', quantity: 2 }],
                                isFbo: true,
                            },
                        ],
                    },
                },
                {
                    provide: YandexOrderService,
                    useValue: {
                        createInvoice,
                        listAwaitingPackaging: () => [],
                        listAwaitingDelivering: () => [],
                        listCanceled: () => [],
                    },
                },
                {
                    provide: PostingFboService,
                    useValue: {
                        createInvoice,
                        listAwaitingPackaging: () => [],
                        listAwaitingDelivering: () => [],
                        listCanceled: () => [],
                    },
                },
                {
                    provide: WbOrderService,
                    useValue: {
                        createInvoice,
                        submitFbsMarkCodes: wbSubmitFbsMarkCodes,
                        getBuyerId: () => 22,
                        isFbo: () => false,
                        listAwaitingPackaging: () => [],
                        listAwaitingDelivering: () => [],
                        listCanceled: () => [],
                        getInvoiceBySrid: jest.fn(),
                    },
                },
                {
                    provide: WbCustomerService,
                    useValue: {
                        getClaimById: jest.fn(),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string, defaultValue?: any) => {
                            if (key === 'SERVICES') return Object.values(GoodServiceEnum);
                            if (key === 'CACHE_TTL_DAYS') return 14;
                            if (key === 'NODE_ENV') return nodeEnv;
                            if (key === 'MARK_CODES_ENABLED') return markCodesEnabled;
                            return defaultValue;
                        }
                    }
                },
                {
                    provide: CACHE_MANAGER,
                    useValue: {
                        get: cacheGet,
                        set: cacheSet,
                    },
                },
                ProcessedCacheService,
                {
                    provide: EventEmitter2,
                    useValue: {
                        emit: eventEmitterEmit,
                    },
                },
            ],
        }).compile();

        service = module.get<OrderService>(OrderService);

        // Clear mocks
        updateByTransactions.mockClear();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('updateTransactions прогоняет неделю новым путём', async () => {
        const dto = {
            date: { from: new Date('2026-07-13'), to: new Date('2026-07-19') },
        };
        runWeek.mockResolvedValueOnce({
            period: { from: '2026-07-13', to: '2026-07-19' },
            loaded: 1085,
            missingDays: [],
            closed: { count: 315, amount: 390593.18 },
            unpaid: [],
            waiting: { count: 196, amount: -5950.45 },
            late: { count: 0, amount: 0 },
            returns: { count: 7, amount: -5367.29 },
            letter: { count: 23, amount: -14319.27 },
            balanced: true,
        });

        const res = await service.updateTransactions(dto);

        expect(runWeek).toHaveBeenCalledWith('2026-07-13', '2026-07-19');
        expect(res.isSuccess).toBe(true);
        // выкупной костыль и старая ручка транзакций удалены целиком
    });

    it('updateTransactions сообщает о несошедшемся контроле', async () => {
        runWeek.mockResolvedValueOnce({
            period: { from: '2026-07-13', to: '2026-07-19' },
            loaded: 10,
            missingDays: ['2026-07-10'],
            closed: { count: 1, amount: 100 },
            unpaid: [{ postingNumber: '111-222-1', amount: 50, reason: 'счёт не найден: возврат либо счёта нет' }],
            waiting: { count: 0, amount: 0 },
            late: { count: 0, amount: 0 },
            returns: { count: 0, amount: 0 },
            letter: { count: 0, amount: 0 },
            balanced: false,
        });

        const res = await service.updateTransactions({
            date: { from: new Date('2026-07-13'), to: new Date('2026-07-19') },
        });

        expect(res.isSuccess).toBe(false);
        expect(res.message).toContain('111-222-1');
    });

    // TODO: этот тест устарел после рефакторинга с кэшированием
    // Нужно переписать под новую логику processWithCache
    /*
    it('test checkNewOrders', async () => {
        await service.checkNewOrders();
        expect(createInvoice.mock.calls[0]).toEqual([
            {
                in_process_at: date,
                posting_number: '321',
                products: [
                    {
                        offer_id: '444',
                        price: '1.11',
                        quantity: 2,
                    },
                ],
                status: 'awaiting_packaging',
            },
            { commit, rollback },
        ]);
        expect(createInvoice.mock.calls[1]).toEqual([
            {
                in_process_at: date,
                posting_number: '123',
                products: [],
                status: 'awaiting_packaging',
            },
            { commit, rollback },
        ]);
        expect(pickupInvoice.mock.calls).toEqual([
            [{ posting_number: '111'}, { commit, rollback }],
            [1, { commit, rollback }],
            [2, { commit, rollback }],
        ]);
        expect(updatePrim.mock.calls[0]).toEqual([
           '111',
           '111' + OZON_ORDER_CANCELLATION_SUFFIX.FBO,
            { commit, rollback },
        ]);
        expect(commit.mock.calls).toHaveLength(4);
    });
    */

    it('should return PostingService when name is GoodServiceEnum.PostingService', () => {
        const result = service.getServiceByName(GoodServiceEnum.OZON);
        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('PostingService');
    });

    it('should return null when name is not a valid GoodServiceEnum value', () => {
        const result = service.getServiceByName(GoodServiceEnum.EXPRESS);
        expect(result).toBeNull();
    });

    it('should process orders with cache and skip already processed; cache flush deferred', async () => {
        const mockService = {
            constructor: { name: 'TestService' },
            listAwaitingPackaging: jest.fn().mockResolvedValue([
                { posting_number: '001', products: [] },
                { posting_number: '002', products: [] },
                { posting_number: '003', products: [] },
            ]),
        };

        // Мокируем кеш: заказ '002' уже обработан (строка с разделителями)
        cacheGet.mockResolvedValueOnce('002');

        const processor = jest.fn().mockResolvedValue(undefined);
        const flushers: (() => Promise<void>)[] = [];

        await service['processWithCache'](
            'test',
            mockService as any,
            await mockService.listAwaitingPackaging(),
            processor,
            flushers,
        );

        // processor вызван только для '001' и '003' (пропустили '002')
        expect(processor).toHaveBeenCalledTimes(2);
        expect(processor).toHaveBeenCalledWith({ posting_number: '001', products: [] });
        expect(processor).toHaveBeenCalledWith({ posting_number: '003', products: [] });

        // Запись в Redis отложена — пока не выполнен flusher, кеш не трогаем
        expect(cacheSet).not.toHaveBeenCalled();
        expect(flushers).toHaveLength(1);

        // Выполняем отложенный flush — только теперь пишем в Redis
        await flushers[0]();

        expect(cacheSet).toHaveBeenCalledTimes(1);
        expect(cacheSet).toHaveBeenCalledWith(
            'processed:test:TestService',
            expect.any(String),
            14 * 24 * 60 * 60 * 1000,
        );
        const savedString = cacheSet.mock.calls[0][1];
        expect(savedString).toContain('001');
        expect(savedString).toContain('002');
        expect(savedString).toContain('003');
    });

    it('упавший элемент не попадает в кеш, флашер при этом отрабатывает', async () => {
        cacheSet.mockClear();
        // Симулируем падение transaction.commit
        const commit = jest.fn().mockRejectedValueOnce(new Error('DB shutdown'));
        const rollback = jest.fn().mockResolvedValue(undefined);
        const failingTx = { commit, rollback };
        (service as any).invoiceService.getTransaction = jest.fn().mockResolvedValue(failingTx);

        // Подкладываем один orderService который успешно обработает один заказ
        const mockOrderable: any = {
            constructor: { name: 'PostingService' },
            isFbo: () => false,
            getBuyerId: () => 1,
            listCanceled: jest.fn().mockResolvedValue([]),
            listAwaitingPackaging: jest.fn().mockResolvedValue([{ posting_number: 'NEW-1', products: [] }]),
            listAwaitingDelivering: jest.fn().mockResolvedValue([]),
            listReturns: jest.fn().mockResolvedValue([]),
            createInvoice: jest.fn().mockResolvedValue({ id: 1 }),
        };
        (service as any).orderServices = [mockOrderable];
        cacheGet.mockResolvedValue('');
        (service as any).invoiceService.isExists = jest.fn().mockResolvedValue(false);

        await service.checkNewOrders();

        // Транзакция теперь на элемент: commit упал → откат этого элемента, флашер
        // всё равно отрабатывает, но упавший номер в сохранённый набор не попадает.
        expect(commit).toHaveBeenCalled();
        expect(rollback).toHaveBeenCalled();
        for (const call of cacheSet.mock.calls) {
            expect(call[1]).not.toContain('NEW-1');
        }
    });

    describe('getInvoiceByClaimId', () => {
        let mockGetClaimById: jest.Mock;
        let mockGetInvoiceBySrid: jest.Mock;

        beforeEach(() => {
            mockGetClaimById = jest.fn();
            mockGetInvoiceBySrid = jest.fn();
            service['wbCustomer'].getClaimById = mockGetClaimById;
            service['wbOrder'].getInvoiceBySrid = mockGetInvoiceBySrid;
        });

        it('should return invoice when claim is found', async () => {
            const mockClaim = {
                id: 'claim-uuid',
                srid: 'test-srid-123',
                order_dt: '2024-03-26T17:06:12.245611',
            };

            const mockInvoice = {
                id: 123,
                buyerId: 456,
                status: 1,
                remark: 'test-srid-123',
            };

            mockGetClaimById.mockResolvedValue(mockClaim);
            mockGetInvoiceBySrid.mockResolvedValue(mockInvoice);

            const result = await service.getInvoiceByClaimId('claim-uuid');

            expect(result).toEqual(mockInvoice);
            expect(mockGetClaimById).toHaveBeenCalledWith('claim-uuid');
            expect(mockGetInvoiceBySrid).toHaveBeenCalledWith({
                dateFrom: '2024-03-26',
                srid: 'test-srid-123',
            });
        });

        it('should return null when claim not found', async () => {
            mockGetClaimById.mockResolvedValue(null);

            const result = await service.getInvoiceByClaimId('non-existent-uuid');

            expect(result).toBeNull();
            expect(mockGetClaimById).toHaveBeenCalledWith('non-existent-uuid');
            expect(mockGetInvoiceBySrid).not.toHaveBeenCalled();
        });

        it('should return null when claim has no srid', async () => {
            const mockClaim = {
                id: 'claim-uuid',
                srid: null,
                order_dt: '2024-03-26T17:06:12.245611',
            };

            mockGetClaimById.mockResolvedValue(mockClaim);

            const result = await service.getInvoiceByClaimId('claim-uuid');

            expect(result).toBeNull();
            expect(mockGetInvoiceBySrid).not.toHaveBeenCalled();
        });

        it('should return null when claim has no order_dt', async () => {
            const mockClaim = {
                id: 'claim-uuid',
                srid: 'test-srid',
                order_dt: null,
            };

            mockGetClaimById.mockResolvedValue(mockClaim);

            const result = await service.getInvoiceByClaimId('claim-uuid');

            expect(result).toBeNull();
            expect(mockGetInvoiceBySrid).not.toHaveBeenCalled();
        });

        it('should return null when invoice not found by srid', async () => {
            const mockClaim = {
                id: 'claim-uuid',
                srid: 'test-srid-123',
                order_dt: '2024-03-26T17:06:12.245611',
            };

            mockGetClaimById.mockResolvedValue(mockClaim);
            mockGetInvoiceBySrid.mockResolvedValue(null);

            const result = await service.getInvoiceByClaimId('claim-uuid');

            expect(result).toBeNull();
            expect(mockGetInvoiceBySrid).toHaveBeenCalledWith({
                dateFrom: '2024-03-26',
                srid: 'test-srid-123',
            });
        });
    });

    describe('cancelOrder', () => {
        let mockInvoiceService: any;
        let mockTransaction: any;

        beforeEach(() => {
            mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
            mockInvoiceService = service['invoiceService'];
            mockInvoiceService.getByPosting = jest.fn();
            mockInvoiceService.update = jest.fn();
            mockInvoiceService.pickupInvoice = jest.fn();
            mockInvoiceService.updatePrim = jest.fn();
            mockInvoiceService.bulkSetStatus = jest.fn();
            eventEmitterEmit.mockClear();
        });

        it('should cancel FBS order with status 3 (not picked) without calling processInvoiceStatus4', async () => {
            const order = { posting_number: '123', isFbo: false } as any;
            const invoice = { status: 3 };
            mockInvoiceService.getByPosting.mockResolvedValue(invoice);

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith(
                '123',
                expect.stringContaining('123'),
                mockTransaction
            );
            expect(mockInvoiceService.bulkSetStatus).toHaveBeenCalledWith([invoice], 0, mockTransaction);
            // Не должно быть ошибки "Cancel wrong status"
            expect(eventEmitterEmit).not.toHaveBeenCalledWith(
                'error.message',
                'Cancel wrong status',
                expect.anything()
            );
        });

        it('should cancel FBS order with status 4 (picked) via processInvoiceStatus4', async () => {
            const order = { posting_number: '456', isFbo: false } as any;
            const invoice = { status: 4 };
            mockInvoiceService.getByPosting.mockResolvedValue(invoice);

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith(
                '456',
                expect.stringContaining('456'),
                mockTransaction
            );
            expect(mockInvoiceService.bulkSetStatus).not.toHaveBeenCalled();
        });

        it('should emit error for FBS order with unexpected status', async () => {
            const order = { posting_number: '789', isFbo: false } as any;
            const invoice = { status: 2 }; // unexpected status
            mockInvoiceService.getByPosting.mockResolvedValue(invoice);

            await service.cancelOrder(order, mockTransaction);

            expect(eventEmitterEmit).toHaveBeenCalledWith(
                'error.message',
                'Cancel wrong status',
                '789: status=2'
            );
        });
    });

    describe('submitFbsMarkCodesForInvoice (single-invoice public API)', () => {
        const invoice = { id: 1, remark: 'P-1', buyerId: 11 } as any;
        const ozonOrderable = {
            constructor: { name: 'PostingService' },
            getBuyerId: () => 11,
            isFbo: () => false,
            submitFbsMarkCodes: ozonSubmitFbsMarkCodes,
        };
        const wbOrderable = {
            constructor: { name: 'WbOrderService' },
            getBuyerId: () => 22,
            isFbo: () => false,
            submitFbsMarkCodes: wbSubmitFbsMarkCodes,
        };

        beforeEach(() => {
            ozonSubmitFbsMarkCodes.mockReset();
            wbSubmitFbsMarkCodes.mockReset();
            (service as any).orderServices = [ozonOrderable, wbOrderable];
        });

        it('MARK_CODES_ENABLED=false → цепочка всё равно вызывается (магазин, отгрузка без марок)', async () => {
            markCodesEnabled = false;
            ozonSubmitFbsMarkCodes.mockResolvedValueOnce({ ok: true, shipped: true });
            const r = await service.submitFbsMarkCodesForInvoice(invoice);
            expect(r).toEqual({ ok: true, shipped: true });
            expect(ozonSubmitFbsMarkCodes).toHaveBeenCalledWith(invoice);
        });

        it('сервис не isMarkSubmittable → undefined', async () => {
            markCodesEnabled = true;
            (service as any).orderServices = [
                {
                    constructor: { name: 'PostingFboService' },
                    getBuyerId: () => 11,
                    isFbo: () => false,
                },
            ];
            const r = await service.submitFbsMarkCodesForInvoice(invoice);
            expect(r).toBeUndefined();
        });

        it('happy path → результат service.submitFbsMarkCodes пробрасывается', async () => {
            markCodesEnabled = true;
            ozonSubmitFbsMarkCodes.mockResolvedValueOnce({ ok: true });
            const r = await service.submitFbsMarkCodesForInvoice(invoice);
            expect(r).toEqual({ ok: true });
            expect(ozonSubmitFbsMarkCodes).toHaveBeenCalledWith(invoice);
        });

        it('service.submitFbsMarkCodes throw → завёрнутый SubmitResultDto, не бросается наружу', async () => {
            markCodesEnabled = true;
            ozonSubmitFbsMarkCodes.mockRejectedValueOnce(new Error('Ozon 500'));
            const r = await service.submitFbsMarkCodesForInvoice(invoice);
            expect(r).toEqual({ ok: false, failed: [{ ki: '*', reason: 'Ozon 500' }] });
        });

        it('WB invoice (buyerId=22) → попадает в WbOrderService', async () => {
            markCodesEnabled = true;
            wbSubmitFbsMarkCodes.mockResolvedValueOnce({ ok: true, skipped: 'no sgtin required' });
            const r = await service.submitFbsMarkCodesForInvoice({ ...invoice, buyerId: 22 });
            expect(r).toEqual({ ok: true, skipped: 'no sgtin required' });
            expect(wbSubmitFbsMarkCodes).toHaveBeenCalledTimes(1);
            expect(ozonSubmitFbsMarkCodes).not.toHaveBeenCalled();
        });
    });

    describe('getShipmentLabelForInvoice (single-invoice public API)', () => {
        const invoice = { id: 1, remark: 'P-1', buyerId: 11 } as any;
        const getShipmentLabel = jest.fn();

        beforeEach(() => {
            getShipmentLabel.mockReset();
            (service as any).orderServices = [
                {
                    constructor: { name: 'PostingService' },
                    getBuyerId: () => 11,
                    isFbo: () => false,
                    getShipmentLabel,
                },
            ];
        });

        it('happy path → PDF провайдера пробрасывается', async () => {
            const pdf = Buffer.from('%PDF');
            getShipmentLabel.mockResolvedValueOnce(pdf);
            const r = await service.getShipmentLabelForInvoice(invoice);
            expect(r).toBe(pdf);
            expect(getShipmentLabel).toHaveBeenCalledWith(invoice);
        });

        it('сервис не IShipmentLabelProvider → BadRequest', async () => {
            (service as any).orderServices = [
                { constructor: { name: 'WbOrderService' }, getBuyerId: () => 11, isFbo: () => false },
            ];
            await expect(service.getShipmentLabelForInvoice(invoice)).rejects.toThrow(BadRequestException);
        });
    });

    describe('prepareFbsMarksForInvoice (фаза 1)', () => {
        const invoice = { id: 1, remark: 'P-1', buyerId: 11 } as any;
        const prepareFbsMarks = jest.fn();
        const submitFbsMarkCodes = jest.fn();

        beforeEach(() => {
            prepareFbsMarks.mockReset();
            submitFbsMarkCodes.mockReset();
            markCodesEnabled = true;
            (service as any).orderServices = [
                {
                    constructor: { name: 'PostingService' },
                    getBuyerId: () => 11,
                    isFbo: () => false,
                    submitFbsMarkCodes,
                    prepareFbsMarks,
                },
            ];
        });

        it('MARK_CODES_ENABLED=false → prepare всё равно зовётся (create-or-get не трогает нашу БД)', async () => {
            markCodesEnabled = false;
            prepareFbsMarks.mockResolvedValueOnce({ ok: true, lines: [] });
            const r = await service.prepareFbsMarksForInvoice(invoice);
            expect(r).toEqual({ ok: true, lines: [] });
            expect(prepareFbsMarks).toHaveBeenCalledWith(invoice);
        });

        it('happy path → результат prepareFbsMarks', async () => {
            prepareFbsMarks.mockResolvedValueOnce({ ok: true, lines: [] });
            const r = await service.prepareFbsMarksForInvoice(invoice);
            expect(r).toEqual({ ok: true, lines: [] });
            expect(prepareFbsMarks).toHaveBeenCalledWith(invoice);
        });

        it('сервис без prepareFbsMarks (ВБ) → undefined', async () => {
            (service as any).orderServices = [
                {
                    constructor: { name: 'WbOrderService' },
                    getBuyerId: () => 11,
                    isFbo: () => false,
                    submitFbsMarkCodes,
                },
            ];
            const r = await service.prepareFbsMarksForInvoice(invoice);
            expect(r).toBeUndefined();
        });

        it('throw → завёрнутый { ok: false, error }', async () => {
            prepareFbsMarks.mockRejectedValueOnce(new Error('Ozon 500'));
            const r = await service.prepareFbsMarksForInvoice(invoice);
            expect(r).toEqual({ ok: false, error: 'Ozon 500' });
        });
    });

    describe('getServiceEnumByBuyerId / getByPostingNumber service', () => {
        beforeEach(() => {
            (service as any).orderServices = [
                { constructor: { name: 'PostingService' }, getBuyerId: () => 11, isFbo: () => false },
                { constructor: { name: 'WbOrderService' }, getBuyerId: () => 22, isFbo: () => false },
            ];
        });

        it('buyerId → enum маркетплейса', () => {
            expect(service.getServiceEnumByBuyerId(11)).toBe(GoodServiceEnum.OZON);
            expect(service.getServiceEnumByBuyerId(22)).toBe(GoodServiceEnum.WB);
            expect(service.getServiceEnumByBuyerId(99)).toBeNull();
        });

        it('getByPostingNumber проставляет service в PostingDto', async () => {
            const getByPostingNumber = jest.fn().mockResolvedValue({ posting_number: 'P-1', products: [] });
            (service as any).orderServices = [
                {
                    constructor: { name: 'PostingService' },
                    getBuyerId: () => 11,
                    isFbo: () => false,
                    getByPostingNumber,
                },
            ];
            const r = await service.getByPostingNumber('P-1', 11);
            expect(r.service).toBe(GoodServiceEnum.OZON);
        });
    });

    describe('getShipmentBarcodeForInvoice (сверка IGK==ШК)', () => {
        const invoice = { id: 1, remark: 'P-1', buyerId: 11 } as any;
        const getShipmentBarcode = jest.fn();

        beforeEach(() => {
            getShipmentBarcode.mockReset();
        });

        it('провайдер есть → ШК пробрасывается', async () => {
            getShipmentBarcode.mockResolvedValueOnce('SHK-1');
            (service as any).orderServices = [
                {
                    constructor: { name: 'PostingService' },
                    getBuyerId: () => 11,
                    isFbo: () => false,
                    getShipmentBarcode,
                },
            ];
            const r = await service.getShipmentBarcodeForInvoice(invoice);
            expect(r).toBe('SHK-1');
            expect(getShipmentBarcode).toHaveBeenCalledWith(invoice);
        });

        it('провайдер без метода (ВБ) → undefined, сверка пропускается', async () => {
            (service as any).orderServices = [
                { constructor: { name: 'WbOrderService' }, getBuyerId: () => 11, isFbo: () => false },
            ];
            const r = await service.getShipmentBarcodeForInvoice(invoice);
            expect(r).toBeUndefined();
        });
    });

    describe('checkNewOrders + MARK_CODES_ENABLED', () => {
        beforeEach(() => {
            cacheGet.mockReset().mockResolvedValue('');
            cacheSet.mockReset().mockResolvedValue(undefined);
            commit.mockResolvedValue(undefined);
            rollback.mockResolvedValue(undefined);
            (service as any).invoiceService.getTransaction = jest.fn().mockResolvedValue({ commit, rollback });
            (service as any).invoiceService.isExists = jest.fn().mockResolvedValue(false);
        });

        it('флаг выключен → submitFbsMarkCodes не вызывается даже если сервис IMarkSubmittable', async () => {
            markCodesEnabled = false;
            const mockOrderable: any = {
                constructor: { name: 'PostingService' },
                isFbo: () => false,
                getBuyerId: () => 11,
                submitFbsMarkCodes: ozonSubmitFbsMarkCodes,
                listCanceled: jest.fn().mockResolvedValue([]),
                listAwaitingPackaging: jest.fn().mockResolvedValue([]),
                listAwaitingDelivering: jest.fn().mockResolvedValue([]),
                listReturns: jest.fn().mockResolvedValue([]),
            };
            (service as any).orderServices = [mockOrderable];

            await service.checkNewOrders();

            expect(listFbsAwaitingShip).not.toHaveBeenCalled();
            expect(ozonSubmitFbsMarkCodes).not.toHaveBeenCalled();
        });

        it('флаг включён, но передача КМ вынесена в pickup → крон submitFbsMarkCodes НЕ вызывает', async () => {
            markCodesEnabled = true;
            const mockOrderable: any = {
                constructor: { name: 'PostingService' },
                isFbo: () => false,
                getBuyerId: () => 11,
                submitFbsMarkCodes: ozonSubmitFbsMarkCodes,
                listCanceled: jest.fn().mockResolvedValue([]),
                listAwaitingPackaging: jest.fn().mockResolvedValue([]),
                listAwaitingDelivering: jest.fn().mockResolvedValue([]),
                listReturns: jest.fn().mockResolvedValue([]),
            };
            (service as any).orderServices = [mockOrderable];

            await service.checkNewOrders();

            expect(listFbsAwaitingShip).not.toHaveBeenCalled();
            expect(ozonSubmitFbsMarkCodes).not.toHaveBeenCalled();
        });

        it('флаг включён + сервис не IMarkSubmittable → submitFbsMarkCodes не вызывается', async () => {
            markCodesEnabled = true;
            const mockOrderable: any = {
                constructor: { name: 'PostingFboService' },
                isFbo: () => true,
                getBuyerId: () => 33,
                // НЕТ submitFbsMarkCodes
                listCanceled: jest.fn().mockResolvedValue([]),
                listAwaitingPackaging: jest.fn().mockResolvedValue([]),
                listAwaitingDelivering: jest.fn().mockResolvedValue([]),
                listReturns: jest.fn().mockResolvedValue([]),
            };
            (service as any).orderServices = [mockOrderable];

            await service.checkNewOrders();

            expect(listFbsAwaitingShip).not.toHaveBeenCalled();
        });
    });

    describe('расщепление кронов: FBO отмены и доставка — раз в сутки (итерация 2)', () => {
        const makeFbo = () => ({
            constructor: { name: 'PostingFboService' },
            isFbo: () => true,
            getBuyerId: () => 33,
            listCanceled: jest.fn().mockResolvedValue([]),
            listAwaitingPackaging: jest.fn().mockResolvedValue([]),
            listAwaitingDelivering: jest.fn().mockResolvedValue([]),
            listReturns: jest.fn().mockResolvedValue([]),
        });
        const makeFbs = () => ({
            constructor: { name: 'PostingService' },
            isFbo: () => false,
            getBuyerId: () => 11,
            listCanceled: jest.fn().mockResolvedValue([]),
            listAwaitingPackaging: jest.fn().mockResolvedValue([]),
            listAwaitingDelivering: jest.fn().mockResolvedValue([]),
            listReturns: jest.fn().mockResolvedValue([]),
        });

        beforeEach(() => {
            cacheGet.mockReset().mockResolvedValue('');
            cacheSet.mockReset().mockResolvedValue(undefined);
            commit.mockResolvedValue(undefined);
            rollback.mockResolvedValue(undefined);
            (service as any).invoiceService.getTransaction = jest.fn().mockResolvedValue({ commit, rollback });
            (service as any).invoiceService.isExists = jest.fn().mockResolvedValue(false);
        });

        it('пятиминутный крон у FBO делает только создание счетов', async () => {
            const fbo: any = makeFbo();
            (service as any).orderServices = [fbo];

            await service.checkNewOrders();

            expect(fbo.listAwaitingPackaging).toHaveBeenCalled();
            expect(fbo.listCanceled).not.toHaveBeenCalled();
            expect(fbo.listAwaitingDelivering).not.toHaveBeenCalled();
        });

        it('пятиминутный крон у не-FBO делает всё как раньше', async () => {
            const fbs: any = makeFbs();
            (service as any).orderServices = [fbs];

            await service.checkNewOrders();

            expect(fbs.listCanceled).toHaveBeenCalled();
            expect(fbs.listAwaitingPackaging).toHaveBeenCalled();
            expect(fbs.listAwaitingDelivering).toHaveBeenCalled();
        });

        it('суточный крон берёт отмены и доставку только у FBO', async () => {
            const fbo: any = makeFbo();
            const fbs: any = makeFbs();
            (service as any).orderServices = [fbo, fbs];

            await service.checkFboOrdersDaily();

            expect(fbo.listCanceled).toHaveBeenCalled();
            expect(fbo.listAwaitingDelivering).toHaveBeenCalled();
            expect(fbo.listAwaitingPackaging).not.toHaveBeenCalled();
            expect(fbs.listCanceled).not.toHaveBeenCalled();
            expect(fbs.listAwaitingDelivering).not.toHaveBeenCalled();
        });
    });

    describe('runFboPackageForTesting', () => {
        const posting = {
            posting_number: 'TEST-MIG-001',
            status: 'awaiting_packaging',
            in_process_at: date.toISOString(),
            products: [{ price: '100', offer_id: '531557', quantity: 1 }],
            analytics_data: { warehouse_name: 'TEST_FBO_MIG_531557' },
            financial_data: { cluster_from: 'Москва, МО и Дальние регионы' },
        } as any;

        it('в development дёргает PostingFboService.createInvoice и коммитит', async () => {
            createInvoice.mockResolvedValueOnce({ id: 999 });
            const result = await service.runFboPackageForTesting(posting);
            expect(createInvoice).toHaveBeenCalledTimes(1);
            expect(createInvoice.mock.calls[0][0]).toBe(posting);
            expect(commit).toHaveBeenCalledTimes(1);
            expect(rollback).not.toHaveBeenCalled();
            expect(result).toEqual({ id: 999 });
        });

        it('откат транзакции и проброс ошибки при exception в createInvoice', async () => {
            createInvoice.mockRejectedValueOnce(new Error('boom'));
            await expect(service.runFboPackageForTesting(posting)).rejects.toThrow('boom');
            expect(rollback).toHaveBeenCalledTimes(1);
            expect(commit).not.toHaveBeenCalled();
        });

        it('бросает ForbiddenException когда NODE_ENV !== development', async () => {
            nodeEnv = 'production';
            await expect(service.runFboPackageForTesting(posting)).rejects.toThrow(/development/);
            expect(createInvoice).not.toHaveBeenCalled();
            expect(commit).not.toHaveBeenCalled();
        });
    });
});
