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
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';
import { MarkScanFbsService } from '../invoice/mark-scan-fbs.service';
import { AccrualWeekService } from '../trade2006.accrual/accrual.week.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('OrderService', () => {
    const mpRecord = jest.fn().mockResolvedValue(true);
    // Отвязка всех кодов счёта — тот же путь, что кнопка «отвязать последний».
    const detachAll = jest.fn().mockResolvedValue(0);
    // Решающая таблица вхолостую (итерация 5): наблюдает и ничего не меняет.
    const dryObservePosting = jest.fn().mockResolvedValue(null);
    const dryObserveReturn = jest.fn().mockResolvedValue(null);
    const mpReturnsEnabled = jest.fn().mockReturnValue(false);
    const mpNeedsExecution = jest.fn().mockReturnValue(false);
    const mpExecute = jest.fn().mockResolvedValue({ done: [], failed: [] });
    const mpIsHandled = jest.fn().mockResolvedValue(false);
    const mpMarkHandled = jest.fn().mockResolvedValue(undefined);
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
    const getStuckFboInvoices = jest.fn().mockResolvedValue([]);
    const pickupFboUnlessShortage = jest.fn().mockResolvedValue(undefined);
    const findByPostingDefault = async (posting: any) => {
        const remark = typeof posting === 'string' ? posting : posting.posting_number;
        return remark === '123' || remark === '111'
            ? { invoice: { id: 1, status: 3, remark }, mark: '', cancelled: false, closed: false }
            : null;
    };
    const findByPosting = jest.fn(findByPostingDefault);
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
    let cancelActionsEnabled = true;
    let reconcileDry = false;
    let reconcileLimit = 200;
    beforeEach(async () => {
        nodeEnv = 'development';
        markCodesEnabled = false;
        cancelActionsEnabled = true;
        reconcileDry = false;
        reconcileLimit = 200;
        getStuckFboInvoices.mockReset().mockResolvedValue([]);
        pickupFboUnlessShortage.mockReset().mockResolvedValue(undefined);
        findByPosting.mockReset().mockImplementation(findByPostingDefault);
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
                        findByPosting,
                        listFbsAwaitingShip,
                        getStuckFboInvoices,
                        pickupFboUnlessShortage,
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
                            if (key === 'MP_CANCEL_ACTIONS_ENABLED') return cancelActionsEnabled;
                            if (key === 'FBO_RECONCILE_DRY') return reconcileDry;
                            if (key === 'FBO_RECONCILE_LIMIT') return reconcileLimit;
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
                    provide: MpEventService,
                    useValue: { record: mpRecord, isHandled: mpIsHandled, markHandled: mpMarkHandled },
                },
                { provide: MarkScanFbsService, useValue: { detachAll } },
                {
                    provide: MpDecisionRunnerService,
                    useValue: {
                        observePosting: dryObservePosting,
                        observeReturn: dryObserveReturn,
                        flush: jest.fn(),
                        returnsEnabled: mpReturnsEnabled,
                        needsExecution: mpNeedsExecution,
                        execute: mpExecute,
                    },
                },
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
            mockInvoiceService.returnMarkCodesToStock = jest.fn().mockResolvedValue(0);
            mockInvoiceService.isInFboShortage = jest.fn().mockResolvedValue(false);
            eventEmitterEmit.mockClear();
            detachAll.mockClear().mockResolvedValue(0);
        });

        it('отмена FBS при STATUS=3 снимает коды сразу, в транзакции элемента', async () => {
            const order = { posting_number: '123', isFbo: false } as any;
            const invoice = { status: 3 };
            mockInvoiceService.getByPosting.mockResolvedValue(invoice);
            detachAll.mockResolvedValue(2);

            await service.cancelOrder(order, mockTransaction);

            // та же транзакция, что у суффикса и статуса: упало — откатится всё разом
            expect(detachAll).toHaveBeenCalledWith(invoice, mockTransaction);
            expect(mockInvoiceService.bulkSetStatus).toHaveBeenCalledWith([invoice], 0, mockTransaction);
        });

        it('сбой отвязки роняет всю отмену — счёт не гасим наполовину', async () => {
            const order = { posting_number: '123', isFbo: false } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ status: 3 });
            detachAll.mockRejectedValue(new Error('MARKCODE_DETACH_FOR_FBS: гард не пустил'));

            await expect(service.cancelOrder(order, mockTransaction)).rejects.toThrow('гард не пустил');

            expect(mockInvoiceService.updatePrim).not.toHaveBeenCalled();
            expect(mockInvoiceService.bulkSetStatus).not.toHaveBeenCalled();
        });

        it('отмена FBS при STATUS=4, посылка УЖЕ отгружена → донор « отмена FBO», коды не трогаем', async () => {
            // товар физически у Ozon: разбирать нечего, а TT=3 нужен, чтобы код уехал
            // миграцией на FBO-продажу. 62 из 115 отмен на проде — именно этот случай.
            const order = { posting_number: '456', isFbo: false, delivering_date: '2026-08-08T10:00:00Z' } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 777, status: 4 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.returnMarkCodesToStock).not.toHaveBeenCalled();
            expect(detachAll).not.toHaveBeenCalled();
            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith('456', '456 отмена FBO', mockTransaction);
        });

        it('признак отгрузки берётся и из substatus, не только из даты', async () => {
            const order = {
                posting_number: '456',
                isFbo: false,
                substatus: 'posting_transferred_to_delivery',
            } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 777, status: 4 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith('456', '456 отмена FBO', mockTransaction);
        });

        it('ВБ: отгруженная отмена → донор « отмена WBFBO» сразу, без CANCEL_WAIT (даже при включённых возвратах)', async () => {
            // Отказник ВБ остаётся на складе ВБ (решение владельца 17.08): заявки
            // возврата не будет, ждать нечего — чужой (озоновский) суффикс отдал бы
            // партию донорскому пулу Ozon.
            mpReturnsEnabled.mockReturnValue(true);
            const order = { posting_number: '9002', isFbo: false, service: GoodServiceEnum.WB, shipped: true } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 900, status: 4 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith('9002', '9002 отмена WBFBO', mockTransaction);
            expect(mpRecord).not.toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'CANCEL_WAIT' }),
                expect.anything(),
            );
            expect(mockInvoiceService.returnMarkCodesToStock).not.toHaveBeenCalled();
            expect(detachAll).not.toHaveBeenCalled();
            mpReturnsEnabled.mockReturnValue(false);
        });

        it('ВБ: отгруженная отмена при неожиданном статусе счёта → письмо, счёт не трогаем', async () => {
            const order = { posting_number: '9003', isFbo: false, service: GoodServiceEnum.WB, shipped: true } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 901, status: 1 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.updatePrim).not.toHaveBeenCalled();
            expect(eventEmitterEmit).toHaveBeenCalledWith(
                'error.message',
                'Отмена отгруженного ВБ-заказа при неожиданном статусе счёта',
                expect.stringContaining('9003'),
            );
        });

        it('ВБ: НЕотгруженная отмена идёт общими ветками (STATUS=3 → отвязка кодов, « отмена»)', async () => {
            const order = { posting_number: '9004', isFbo: false, service: GoodServiceEnum.WB, shipped: false } as any;
            const invoice = { id: 902, status: 3 };
            mockInvoiceService.getByPosting.mockResolvedValue(invoice);

            await service.cancelOrder(order, mockTransaction);

            expect(detachAll).toHaveBeenCalledWith(invoice, mockTransaction);
            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith('9004', '9004 отмена', mockTransaction);
        });

        it('счёт по точному PRIM не найден (неизвестный хвост) → ошибка, а не молчаливый скип', async () => {
            const order = { posting_number: '9005', isFbo: false } as any;
            mockInvoiceService.getByPosting.mockResolvedValue(null);

            await expect(service.cancelOrder(order, mockTransaction)).rejects.toThrow('разобрать руками');
        });

        it('отгруженная отмена при включённых возвратах → счёт не трогаем, в журнал ложится CANCEL_WAIT', async () => {
            mpReturnsEnabled.mockReturnValue(true);
            const order = { posting_number: '456', isFbo: false, delivering_date: '2026-08-08T10:00:00Z' } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 777, status: 4 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.updatePrim).not.toHaveBeenCalled();
            expect(mpRecord).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'CANCEL_WAIT', extId: '456', state: 'waiting' }),
                mockTransaction,
            );
            mpReturnsEnabled.mockReturnValue(false);
        });

        it('отмена FBO STATUS=4 при включённых возвратах → тоже ждём запись возврата', async () => {
            mpReturnsEnabled.mockReturnValue(true);
            const order = { posting_number: 'FBO-9', isFbo: true } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 778, status: 4 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.pickupInvoice).not.toHaveBeenCalled();
            expect(mockInvoiceService.updatePrim).not.toHaveBeenCalled();
            expect(mpRecord).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'CANCEL_WAIT', extId: 'FBO-9' }),
                mockTransaction,
            );
            mpReturnsEnabled.mockReturnValue(false);
        });

        it('отмена FBO STATUS=3 (недобор) → донор сразу и при включённых возвратах', async () => {
            mpReturnsEnabled.mockReturnValue(true);
            const order = { posting_number: 'FBO-3', isFbo: true } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 779, status: 3 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith('FBO-3', 'FBO-3 отмена FBO', mockTransaction);
            mpReturnsEnabled.mockReturnValue(false);
        });

        it('отмена недоборного FBO-счёта: не подбираем, донором не помечаем, письмо на руки', async () => {
            const order = { posting_number: 'FBO-SH', isFbo: true } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 780, status: 3 });
            mockInvoiceService.isInFboShortage.mockResolvedValue(true);

            await service.cancelOrder(order, mockTransaction);

            // pickup «подобрал» бы недостающее из воздуха — фантом на остатках
            expect(mockInvoiceService.pickupInvoice).not.toHaveBeenCalled();
            expect(mockInvoiceService.updatePrim).not.toHaveBeenCalled();
            expect(eventEmitterEmit).toHaveBeenCalledWith(
                'error.message',
                expect.stringContaining('недоборного FBO'),
                expect.stringContaining('FBO-SH'),
            );
        });

        it('отмена FBO при неожиданном статусе счёта (0, погашен) → не трогаем, письмо', async () => {
            const order = { posting_number: 'FBO-0', isFbo: true } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 781, status: 0 });

            await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.pickupInvoice).not.toHaveBeenCalled();
            expect(mockInvoiceService.updatePrim).not.toHaveBeenCalled();
            expect(eventEmitterEmit).toHaveBeenCalledWith(
                'error.message',
                expect.stringContaining('неожиданном статусе'),
                expect.stringContaining('STATUS=0'),
            );
        });

        it('отмена FBS при STATUS=4, посылка У НАС: коды на склад (TT→0), привязка остаётся, суффикс « отмена»', async () => {
            const order = { posting_number: '456', isFbo: false } as any;
            const invoice = { id: 777, number: 1777, status: 4 };
            mockInvoiceService.getByPosting.mockResolvedValue(invoice);
            mockInvoiceService.returnMarkCodesToStock = jest.fn().mockResolvedValue(3);

            const letter = await service.cancelOrder(order, mockTransaction);

            expect(mockInvoiceService.returnMarkCodesToStock).toHaveBeenCalledWith(777, mockTransaction);
            // отвязки нет: по привязке Дельфи потребует отсканировать содержимое коробки
            expect(detachAll).not.toHaveBeenCalled();
            // « отмена», а НЕ « отмена FBO»: товар лежит у нас, донором счёт быть не должен
            expect(mockInvoiceService.updatePrim).toHaveBeenCalledWith('456', '456 отмена', mockTransaction);

            // письмо кладовщику — замыканием, ПОСЛЕ коммита: до вызова его нет
            expect(eventEmitterEmit).not.toHaveBeenCalled();
            letter?.();
            expect(eventEmitterEmit).toHaveBeenCalledWith(
                'error.message',
                'Отменён собранный заказ — разобрать посылку',
                expect.stringContaining('расформировать счёт №1777'),
            );
            expect(eventEmitterEmit.mock.calls[0][2]).toContain('отсканировать коды (их 3)');
        });

        it('магазин: собранная отмена без кодов (returned=0) → в письме нет строки про сканирование', async () => {
            const order = { posting_number: '456', isFbo: false } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 777, number: 1777, status: 4 });
            mockInvoiceService.returnMarkCodesToStock = jest.fn().mockResolvedValue(0);

            const letter = await service.cancelOrder(order, mockTransaction);
            letter?.();

            const body = eventEmitterEmit.mock.calls[0][2];
            expect(body).not.toContain('отсканировать');
            expect(body).toContain('расформировать счёт №1777');
        });

        it('отмена FBO кодов НЕ трогает — TT=3 нужен, чтобы код уехал миграцией с донора', async () => {
            const order = { posting_number: '789', isFbo: true } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ status: 4 });

            await service.cancelOrder(order, mockTransaction);

            expect(detachAll).not.toHaveBeenCalled();
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

        it('отмена FBS при STATUS=4 статус руками не двигает — его ставит updatePrim', async () => {
            const order = { posting_number: '456', isFbo: false } as any;
            mockInvoiceService.getByPosting.mockResolvedValue({ id: 777, number: 1777, status: 4 });
            mockInvoiceService.returnMarkCodesToStock = jest.fn().mockResolvedValue(0);

            await service.cancelOrder(order, mockTransaction);

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

    describe('возвраты: дедуп журналом вместо Redis (итерация 4)', () => {
        // returnCounts — БОЕВАЯ реализация PostingService поверх моков ручек:
        // подсчёт частичности проверяется здесь же, без дублирования логики в спеке.
        const makeService = (returns: any[]) => {
            const svc: any = {
                constructor: { name: 'PostingService' },
                isFbo: () => false,
                getBuyerId: () => 11,
                logger: { warn: jest.fn() },
                listReturns: jest.fn().mockResolvedValue(returns),
                listReturnsByPosting: jest.fn().mockResolvedValue([]),
                getPostingUnits: jest.fn().mockResolvedValue(null),
            };
            svc.returnCounts = PostingService.prototype.returnCounts.bind(svc);
            return svc;
        };

        beforeEach(() => {
            mpRecord.mockReset().mockResolvedValue(true);
            dryObserveReturn.mockClear();
            mpIsHandled.mockReset().mockResolvedValue(false);
            mpMarkHandled.mockReset().mockResolvedValue(undefined);
            commit.mockResolvedValue(undefined);
            rollback.mockResolvedValue(undefined);
            (service as any).invoiceService.getTransaction = jest.fn().mockResolvedValue({ commit, rollback });
        });

        it('состояние возврата входит в ключ события', async () => {
            const svc: any = makeService([
                { id: 1003975443, posting_number: 'НЕТ-СЧЁТА', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);

            await service.processReturns(svc, []);

            expect(mpRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    service: 'OZON',
                    kind: 'RETURN',
                    extId: '1003975443',
                    state: 'ReturnedToOzon',
                }),
            );
        });

        it('уже обработанное событие пропускается, счёт не трогаем', async () => {
            mpIsHandled.mockResolvedValue(true);
            const svc: any = makeService([
                { id: 1, posting_number: '111', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);

            await service.processReturns(svc, []);

            expect(mpMarkHandled).not.toHaveBeenCalled();
            expect((service as any).invoiceService.getTransaction).not.toHaveBeenCalled();
        });

        it('отметка «обработано» ставится ПОСЛЕ действий, а не до', async () => {
            const svc: any = makeService([
                { id: 2, posting_number: '111', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);

            await service.processReturns(svc, []);

            expect(mpMarkHandled).toHaveBeenCalledTimes(1);
        });

        it('новое состояние возврата идёт в решающую таблицу вхолостую, знакомое — нет', async () => {
            const svc: any = makeService([
                { id: 4, posting_number: '111', schema: 'Fbs', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);
            svc.listReturnsByPosting = jest.fn().mockResolvedValue([]);
            svc.getPostingUnits = jest.fn().mockResolvedValue(null);

            await service.processReturns(svc, []);
            expect(dryObserveReturn).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }), undefined, 'OZON');

            dryObserveReturn.mockClear();
            mpRecord.mockResolvedValue(false);
            await service.processReturns(svc, []);
            expect(dryObserveReturn).not.toHaveBeenCalled();
        });

        it('частичность: записи возврата за всю историю против единиц отправления, заявочные не в счёт', async () => {
            const svc: any = makeService([
                { id: 5, posting_number: '111', schema: 'Fbs', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);
            svc.listReturnsByPosting = jest.fn().mockResolvedValue([
                { visual: { status: { sys_name: 'ReturnedToOzon' } } },
                { visual: { status: { sys_name: 'ReturnedToOzon' } } },
                { visual: { status: { sys_name: 'Rejected' } } },
            ]);
            svc.getPostingUnits = jest.fn().mockResolvedValue(3);

            await service.processReturns(svc, []);

            expect(svc.listReturnsByPosting).toHaveBeenCalledWith('111');
            expect(dryObserveReturn.mock.calls[0][1]).toEqual({ returnedRows: 2, postingUnits: 3 });
        });

        it('возврат FBO и статусы без физики: состав у Ozon не спрашиваем', async () => {
            const svc: any = makeService([
                { id: 6, posting_number: '111', schema: 'Fbo', visual: { status: { sys_name: 'ReturnedToOzon' } } },
                { id: 7, posting_number: '111', schema: 'Fbs', visual: { status: { sys_name: 'MovingToOzon' } } },
            ]);
            svc.listReturnsByPosting = jest.fn().mockResolvedValue([]);
            svc.getPostingUnits = jest.fn().mockResolvedValue(1);

            await service.processReturns(svc, []);

            expect(svc.getPostingUnits).not.toHaveBeenCalled();
            expect(dryObserveReturn.mock.calls.every((call) => call[1] === undefined)).toBe(true);
        });

        it('сбой ручек Ozon при подсчёте частичности не роняет разбор возврата', async () => {
            const svc: any = makeService([
                { id: 8, posting_number: '111', schema: 'Fbs', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);
            svc.listReturnsByPosting = jest.fn().mockRejectedValue(new Error('502 Bad Gateway'));
            svc.getPostingUnits = jest.fn().mockResolvedValue(1);

            await service.processReturns(svc, []);

            expect(dryObserveReturn).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }), undefined, 'OZON');
        });

        it('заявочный статус при выключенном флаге: счёт не трогаем, событие закрыто', async () => {
            updatePrim.mockClear();
            const invoiceService = (service as any).invoiceService;
            invoiceService.update.mockClear();
            invoiceService.findByPosting = jest
                .fn()
                .mockResolvedValue({ invoice: { id: 9, status: 4, remark: '111' }, mark: '', cancelled: false, closed: false });
            const svc: any = makeService([
                { id: 9, posting_number: '111', visual: { status: { sys_name: 'Rejected' } } },
            ]);

            await service.processReturns(svc, []);

            expect(invoiceService.getTransaction).not.toHaveBeenCalled();
            expect(invoiceService.update).not.toHaveBeenCalled();
            expect(updatePrim).not.toHaveBeenCalled();
            expect(mpMarkHandled).toHaveBeenCalledTimes(1);
        });

        it('физический возврат при выключенном флаге по-прежнему делает донора', async () => {
            updatePrim.mockClear();
            const invoiceService = (service as any).invoiceService;
            invoiceService.findByPosting = jest
                .fn()
                .mockResolvedValue({ invoice: { id: 9, status: 4, remark: '111' }, mark: '', cancelled: false, closed: false });
            const svc: any = makeService([
                { id: 9, posting_number: '111', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);

            await service.processReturns(svc, []);

            expect(updatePrim).toHaveBeenCalledWith('111', expect.stringContaining('отмена FBO'), expect.anything());
            expect(mpMarkHandled).toHaveBeenCalledTimes(1);
        });

        it('сбой действия → «обработано» не ставится, событие вернётся в следующий проход', async () => {
            (service as any).invoiceService.getTransaction = jest.fn().mockRejectedValue(new Error('DB down'));
            const svc: any = makeService([
                { id: 3, posting_number: '111', visual: { status: { sys_name: 'ReturnedToOzon' } } },
            ]);

            await service.processReturns(svc, []);

            expect(mpMarkHandled).not.toHaveBeenCalled();
        });

        describe('итерация 8 — возвраты исполняет решающая таблица', () => {
            const decision = { branch: 'return/returned-to-ozon' } as any;
            const item = { id: 21, posting_number: '111', visual: { status: { sys_name: 'ReturnedToOzon' } } };

            beforeEach(() => {
                mpReturnsEnabled.mockReturnValue(true);
                mpNeedsExecution.mockReturnValue(true);
                mpExecute.mockClear().mockResolvedValue({ done: [], failed: [] });
                dryObserveReturn.mockResolvedValue(decision);
                updatePrim.mockClear();
            });
            afterEach(() => {
                mpReturnsEnabled.mockReturnValue(false);
                mpNeedsExecution.mockReturnValue(false);
                dryObserveReturn.mockResolvedValue(null);
            });

            it('решение исполняется в транзакции элемента, старый путь «донор при возврате» молчит', async () => {
                await service.processReturns(makeService([item]) as any, []);

                expect(mpExecute).toHaveBeenCalledWith(decision, expect.anything());
                expect(commit).toHaveBeenCalled();
                expect(updatePrim).not.toHaveBeenCalled();
                expect(mpMarkHandled).toHaveBeenCalledTimes(1);
            });

            it('знакомое, но необработанное событие ретраится: решение пересчитывается', async () => {
                mpRecord.mockResolvedValue(false);

                await service.processReturns(makeService([item]) as any, []);

                expect(dryObserveReturn).toHaveBeenCalledTimes(1);
                expect(mpExecute).toHaveBeenCalledTimes(1);
                expect(mpMarkHandled).toHaveBeenCalledTimes(1);
            });

            it('потолок прогона (решение null) → событие не помечается, возьмётся следующим проходом', async () => {
                dryObserveReturn.mockResolvedValue(null);

                await service.processReturns(makeService([item]) as any, []);

                expect(mpExecute).not.toHaveBeenCalled();
                expect(mpMarkHandled).not.toHaveBeenCalled();
            });

            it('решение без включённых действий — пометка без транзакции', async () => {
                mpNeedsExecution.mockReturnValue(false);

                await service.processReturns(makeService([item]) as any, []);

                expect(mpExecute).not.toHaveBeenCalled();
                expect((service as any).invoiceService.getTransaction).not.toHaveBeenCalled();
                expect(mpMarkHandled).toHaveBeenCalledTimes(1);
            });

            it('сбой исполнения → «обработано» не ставится', async () => {
                mpExecute.mockRejectedValueOnce(new Error('DB down'));

                await service.processReturns(makeService([item]) as any, []);

                expect(mpMarkHandled).not.toHaveBeenCalled();
            });
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

        it('рубильник MP_CANCEL_ACTIONS_ENABLED=false: отмены не-FBO не читаются и не помечаются, FBO работает', async () => {
            cancelActionsEnabled = false;
            const fbo: any = makeFbo();
            const fbs: any = makeFbs();

            await service.cancelOrders(fbo, []);
            await service.cancelOrders(fbs, []);

            expect(fbo.listCanceled).toHaveBeenCalled();
            expect(fbs.listCanceled).not.toHaveBeenCalled();
            expect(cacheSet).not.toHaveBeenCalled();
        });

        it('отмена FBO идёт в решающую таблицу вхолостую, отмена FBS — нет (её считает наблюдатель)', async () => {
            const fbo: any = makeFbo();
            fbo.listCanceled = jest.fn().mockResolvedValue([{ posting_number: 'FBO-1', isFbo: true }]);
            const fbs: any = makeFbs();
            fbs.listCanceled = jest.fn().mockResolvedValue([{ posting_number: '111', isFbo: false }]);
            (service as any).orderServices = [fbo, fbs];
            dryObservePosting.mockClear();

            await service.cancelOrders(fbo, []);
            await service.cancelOrders(fbs, []);

            expect(dryObservePosting).toHaveBeenCalledTimes(1);
            expect(dryObservePosting).toHaveBeenCalledWith('FBO-1', 'FBO', 'cancel');
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

    describe('reconcileStuckFbo — сверка зависших FBO-счетов', () => {
        const date = new Date('2026-08-15T00:00:00.000Z');
        const stuckInvoice = (id: number, remark: string) => ({ id, number: id + 100, remark, status: 3, date });
        const fboService = (shipped: Map<string, string>) => ({
            getBuyerId: () => 24416,
            isFbo: () => true,
            listShippedSince: jest.fn().mockResolvedValue(shipped),
        });

        // Боевые commit/rollback возвращают промис (perItem делает rollback(true).catch(...)),
        // а общий mockReset в внешнем beforeEach оставляет undefined.
        beforeEach(() => {
            commit.mockResolvedValue(undefined);
            rollback.mockResolvedValue(undefined);
        });

        it('сервис без listShippedSince (ВБ, Яндекс, Ozon FBS) шаг не выполняет вовсе', async () => {
            await service.reconcileStuckFbo({ getBuyerId: () => 22, isFbo: () => false } as any);
            expect(getStuckFboInvoices).not.toHaveBeenCalled();
        });

        it('долга нет — в маркетплейс не ходим', async () => {
            const fbo = fboService(new Map());
            await service.reconcileStuckFbo(fbo as any);
            expect(fbo.listShippedSince).not.toHaveBeenCalled();
        });

        it('подбирает счёт, который маркетплейс уже собрал и повёз', async () => {
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123')]);
            await service.reconcileStuckFbo(fboService(new Map([['123', 'awaiting_deliver']])) as any);
            expect(pickupFboUnlessShortage).toHaveBeenCalledTimes(1);
            expect(commit).toHaveBeenCalled();
        });

        it('не подбирает счёт, который ещё не уехал', async () => {
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123')]);
            await service.reconcileStuckFbo(fboService(new Map()) as any);
            expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
        });

        // Гонка: между выборкой списка и подбором параллельная ветка увела счёт в доноры.
        it('не подбирает счёт, помеченный отменой после выборки', async () => {
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123')]);
            findByPosting.mockResolvedValueOnce({
                invoice: { id: 1, status: 1, remark: '123' },
                mark: ' отмена FBO',
                cancelled: true,
                closed: false,
            } as any);
            await service.reconcileStuckFbo(fboService(new Map([['123', 'delivering']])) as any);
            expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
        });

        // Тот же гард на случай, когда счёт успели подобрать между выборкой и подбором.
        it('не подбирает счёт, ушедший из STATUS=3 после выборки', async () => {
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123')]);
            findByPosting.mockResolvedValueOnce({
                invoice: { id: 1, status: 4, remark: '123' },
                mark: '',
                cancelled: false,
                closed: false,
            } as any);
            await service.reconcileStuckFbo(fboService(new Map([['123', 'delivered']])) as any);
            expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
        });

        it('сухой прогон считает, но не подбирает', async () => {
            reconcileDry = true;
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123')]);
            await service.reconcileStuckFbo(fboService(new Map([['123', 'delivered']])) as any);
            expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
            expect(eventEmitterEmit).toHaveBeenCalledWith(
                'error.message',
                'Сверка зависших FBO',
                expect.stringContaining('сухой прогон'),
            );
        });

        it('за прогон берёт не больше потолка, остаток ждёт следующего', async () => {
            reconcileLimit = 1;
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123'), stuckInvoice(2, '111')]);
            await service.reconcileStuckFbo(
                fboService(
                    new Map([
                        ['123', 'delivered'],
                        ['111', 'delivered'],
                    ]),
                ) as any,
            );
            expect(pickupFboUnlessShortage).toHaveBeenCalledTimes(1);
        });

        // Дедлок на триггерах PODBPOS/RESERVEDPOS ловился живьём при ручном разборе 19.08.
        it('повторяет попытку при конфликте блокировки', async () => {
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123')]);
            pickupFboUnlessShortage
                .mockRejectedValueOnce(new Error('Deadlock, Update conflicts with concurrent update'))
                .mockResolvedValueOnce(undefined);
            await service.reconcileStuckFbo(fboService(new Map([['123', 'delivered']])) as any);
            expect(pickupFboUnlessShortage).toHaveBeenCalledTimes(2);
        });

        it('ошибку, не связанную с блокировкой, не повторяет, а копит в сбои прогона', async () => {
            getStuckFboInvoices.mockResolvedValue([stuckInvoice(1, '123')]);
            pickupFboUnlessShortage.mockRejectedValue(new Error('boom'));
            await service.reconcileStuckFbo(fboService(new Map([['123', 'delivered']])) as any);
            expect(pickupFboUnlessShortage).toHaveBeenCalledTimes(1);
        });
    });
});
