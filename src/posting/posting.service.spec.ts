import { Test, TestingModule } from '@nestjs/testing';
import { PostingService } from './posting.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { CreateOrGetExemplarsCommand } from './commands/create-or-get-exemplars.command';
import { BuildExemplarsPayloadCommand } from './commands/build-exemplars-payload.command';
import { ValidateExemplarsCommand } from './commands/validate-exemplars.command';
import { SetAndConfirmExemplarsCommand } from './commands/set-and-confirm-exemplars.command';
import { ShipExemplarsCommand } from './commands/ship-exemplars.command';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';

describe('PostingService', () => {
    let service: PostingService;
    const create = jest.fn();
    const createInvoiceFromPostingDto = jest.fn();
    const commit = jest.fn();
    const getByPosting = jest.fn();
    const getInvoiceLines = jest.fn();
    const bulkSetStatus = jest.fn();
    const updatePrim = jest.fn();
    const ozonApiMethod = jest.fn();
    const ozonApiMethodBinary = jest.fn();
    const getAttachedMarkCodesByScode = jest.fn();
    const getKmFullByKi = jest.fn();
    const getGtdByKi = jest.fn();
    const getPickedPartiesGtdByScode = jest.fn();
    const getByPostingNumbers = jest.fn();
    const mpRecord = jest.fn().mockResolvedValue(true);
    const mpIsHandled = jest.fn().mockResolvedValue(false);
    const mpMarkHandled = jest.fn();
    const mpListUnhandled = jest.fn().mockResolvedValue([]);
    // журнал пуст → окно как при холодном старте, поведение прежних тестов сохраняется
    const mpWindowStart = jest.fn();
    // решающая таблица вхолостую (итерация 5) — только наблюдает
    const dryObservePosting = jest.fn().mockResolvedValue(null);
    const dryFlush = jest.fn();
    const mpSalesEnabled = jest.fn().mockReturnValue(false);
    const mpNeedsExecution = jest.fn().mockReturnValue(false);
    const mpExecute = jest.fn().mockResolvedValue({ done: [], failed: [] });
    // Зеркало реального runner.handleDelivered поверх моков: сценарии ретрая/пометки
    // остаются проверяемыми здесь, оркестровку в бою тестирует спек runner'а.
    const mpHandleDelivered = jest.fn(async (event: any) => {
        try {
            if (await mpIsHandled(event)) return;
            const decision = await dryObservePosting(event.posting ?? event.extId, 'FBS', 'delivered');
            if (!decision) return;
            if (mpNeedsExecution(decision)) await mpExecute(decision);
            await mpMarkHandled(event);
        } catch (e) {
            /* как в бою: сбой не роняет прогон и не помечает событие */
        }
    });
    let markMigrationEnabled = false;
    let nodeEnv: string | undefined;
    let services: string[] = [];
    const date = new Date();
    const postings = [
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
    ];
    // v4: ответ плоский, без обёртки result; has_next=false — одна страница
    const orderList = jest.fn().mockResolvedValue({
        postings,
        has_next: false,
        cursor: '',
    });
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PostingService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        isExists: async (remark: string) => remark === '123',
                        create,
                        createInvoiceFromPostingDto,
                        getByPosting,
                        getInvoiceLines,
                        bulkSetStatus,
                        updatePrim,
                        getAttachedMarkCodesByScode,
                        getKmFullByKi,
                        getGtdByKi,
                        getPickedPartiesGtdByScode,
                        getByPostingNumbers,
                        getTransaction: () => ({ commit }),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string, def?: any) => {
                            if (key === 'OZON_BUYER_ID') return 24416;
                            if (key === 'MARK_CODES_ENABLED') return markMigrationEnabled;
                            if (key === 'NODE_ENV') return nodeEnv;
                            if (key === 'SERVICES') return services;
                            return def;
                        },
                    },
                },
                {
                    provide: ProductService,
                    useValue: { orderList },
                },
                {
                    provide: OzonApiService,
                    useValue: {
                        method: ozonApiMethod,
                        methodBinary: ozonApiMethodBinary,
                    },
                },
                {
                    provide: MpEventService,
                    useValue: {
                        record: mpRecord,
                        windowStart: mpWindowStart,
                        isHandled: mpIsHandled,
                        markHandled: mpMarkHandled,
                        listUnhandled: mpListUnhandled,
                    },
                },
                {
                    provide: MpDecisionRunnerService,
                    useValue: {
                        observePosting: dryObservePosting,
                        handleDelivered: mpHandleDelivered,
                        flush: dryFlush,
                        salesEnabled: mpSalesEnabled,
                        needsExecution: mpNeedsExecution,
                        execute: mpExecute,
                    },
                },
                CreateOrGetExemplarsCommand,
                BuildExemplarsPayloadCommand,
                ValidateExemplarsCommand,
                SetAndConfirmExemplarsCommand,
                ShipExemplarsCommand,
            ],
        }).compile();

        orderList.mockClear();
        dryObservePosting.mockClear();
        mpHandleDelivered.mockClear();
        dryFlush.mockClear();
        mpRecord.mockReset().mockResolvedValue(true);
        ozonApiMethod.mockClear();
        ozonApiMethodBinary.mockReset();
        getByPosting.mockReset();
        getInvoiceLines.mockReset();
        getAttachedMarkCodesByScode.mockReset();
        getKmFullByKi.mockReset();
        getGtdByKi.mockReset();
        getGtdByKi.mockResolvedValue(null);
        getPickedPartiesGtdByScode.mockReset();
        getPickedPartiesGtdByScode.mockResolvedValue([]);
        getByPostingNumbers.mockReset();
        mpRecord.mockReset().mockResolvedValue(true);
        mpListUnhandled.mockClear().mockResolvedValue([]);
        mpWindowStart
            .mockReset()
            .mockImplementation(async (_s: any, _k: any, days: number) =>
                DateTime.now().minus({ days }).startOf('day').toJSDate(),
            );
        getByPostingNumbers.mockResolvedValue([]);
        markMigrationEnabled = false;
        nodeEnv = undefined;
        services = [];
        service = module.get<PostingService>(PostingService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test delivery list', async () => {
        const products = await service.listAwaitingDelivering();
        expect(products).toEqual(postings);
    });

    it('пагинация курсором: собирает все страницы и передаёт курсор из ответа', async () => {
        orderList.mockResolvedValueOnce({ postings: [postings[0]], has_next: true, cursor: 'CUR1' });
        orderList.mockResolvedValueOnce({ postings: [postings[1]], has_next: false, cursor: '' });

        const products = await service.listAwaitingDelivering();

        expect(products).toEqual(postings);
        expect(orderList).toHaveBeenCalledTimes(2);
        expect(orderList.mock.calls[0][2]).toBe('');
        expect(orderList.mock.calls[1][2]).toBe('CUR1');
    });

    it('пагинация курсором: не зацикливается, если Ozon вернул тот же курсор', async () => {
        orderList.mockResolvedValue({ postings: [postings[0]], has_next: true, cursor: 'SAME' });

        const products = await service.listAwaitingDelivering();

        // вторая страница пришла с тем же курсором — выходим, а не крутим бесконечно
        expect(orderList).toHaveBeenCalledTimes(2);
        expect(products).toHaveLength(2);
    });

    it('test packaging list', async () => {
        await service.listAwaitingPackaging();
        expect(orderList.mock.calls[0]).toEqual([
            {
                since: DateTime.now().minus({ day: 5 }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                statuses: ['awaiting_packaging'],
            },
            100,
            '',
        ]);
    });

    describe('окна выборки (итерация 2)', () => {
        // соседние тесты подменяют реализацию мока насовсем (mockResolvedValue), а beforeEach
        // сверху делает только mockClear — возвращаем одностраничный ответ явно.
        beforeEach(() => {
            orderList.mockResolvedValue({ postings, has_next: false, cursor: '' });
        });

        it('окно действий по отменам осталось 7 дней и без фильтра смены статуса', async () => {
            await service.listCanceled();

            expect(orderList.mock.calls[0][0]).toEqual({
                since: DateTime.now().minus({ day: 7 }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                statuses: ['cancelled'],
            });
        });

        it('без OZON в SERVICES наблюдение не ходит в API вовсе', async () => {
            await service.observeWideWindow();

            expect(orderList).not.toHaveBeenCalled();
        });

        it('наблюдение: 4 статуса, окно создания 45 дней, окно смены статуса 2 дня', async () => {
            services = ['ozon'];

            await service.observeWideWindow();

            expect(orderList).toHaveBeenCalledTimes(4);
            expect(orderList.mock.calls.map((call) => call[0].statuses[0])).toEqual([
                'cancelled',
                'delivered',
                'awaiting_deliver',
                'delivering',
            ]);
            expect(orderList.mock.calls[0][0]).toEqual({
                since: DateTime.now().minus({ day: 45 }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                statuses: ['cancelled'],
                last_changed_status_date: {
                    from: DateTime.now().minus({ day: 2 }).startOf('day').toISO(),
                    to: DateTime.now().endOf('day').toISO(),
                },
            });
        });

        it('окно смены статуса берётся из журнала, а не от «сейчас» (итерация 4)', async () => {
            services = ['ozon'];
            const lastSeen = DateTime.now().minus({ hour: 5 }).toJSDate();
            mpWindowStart.mockResolvedValue(lastSeen);

            await service.observeWideWindow();

            expect(mpWindowStart).toHaveBeenCalledWith('OZON', 'POSTING_FBS', 2, 2);
            expect(orderList.mock.calls[0][0].last_changed_status_date.from).toBe(
                DateTime.fromJSDate(lastSeen).toISO(),
            );
        });

        it('увиденные отправления пишутся в журнал', async () => {
            services = ['ozon'];

            await service.observeWideWindow();

            expect(mpRecord).toHaveBeenCalledWith(
                expect.objectContaining({ service: 'OZON', kind: 'POSTING_FBS', extId: '123', state: 'cancelled' }),
            );
        });

        it('наблюдение ничего не делает — ни счетов, ни переименований', async () => {
            services = ['ozon'];
            getByPostingNumbers.mockResolvedValue([{ id: 555, status: 3, remark: '123' }]);
            getAttachedMarkCodesByScode.mockResolvedValue([{ ki: 'KI-1' }]);

            await service.observeWideWindow();

            expect(createInvoiceFromPostingDto).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
            expect(updatePrim).not.toHaveBeenCalled();
            expect(bulkSetStatus).not.toHaveBeenCalled();
        });

        it('новое событие отмены и доставки уходит в решающую таблицу вхолостую', async () => {
            services = ['ozon'];
            mpRecord.mockResolvedValue(true);

            await service.observeWideWindow();

            expect(dryObservePosting).toHaveBeenCalledWith('123', 'FBS', 'cancel', false);
            expect(dryObservePosting).toHaveBeenCalledWith('123', 'FBS', 'delivered');
            // awaiting_deliver и delivering — только наблюдение, решений по ним нет:
            // 2 отправления × 2 статуса, а не × 4
            expect(dryObservePosting).toHaveBeenCalledTimes(4);
            expect(dryObservePosting.mock.calls.map((call) => call[2])).toEqual([
                'cancel',
                'cancel',
                'delivered',
                'delivered',
            ]);
            expect(dryFlush).toHaveBeenCalledWith('observeFbsWideWindow');
        });

        it('знакомое событие в решающую таблицу не идёт: дедуп держит журнал', async () => {
            services = ['ozon'];
            mpRecord.mockResolvedValue(false);

            await service.observeWideWindow();

            expect(dryObservePosting).not.toHaveBeenCalled();
        });

        it('не записалось в журнал → решения не считаем (иначе письмо на каждый проход)', async () => {
            services = ['ozon'];
            mpRecord.mockRejectedValue(new Error('DB down'));

            await service.observeWideWindow();

            expect(dryObservePosting).not.toHaveBeenCalled();
        });

        it('наблюдение: упавший статус не роняет остальные', async () => {
            services = ['ozon'];
            orderList.mockRejectedValueOnce(new Error('502 Bad Gateway'));

            await service.observeWideWindow();

            expect(orderList).toHaveBeenCalledTimes(4);
        });
    });

    describe('итерация 7 — продажа исполняется по флагу', () => {
        const decision = { branch: 'delivered/normal' } as any;
        beforeEach(() => {
            services = ['ozon'];
            orderList.mockResolvedValue({ postings, has_next: false, cursor: '' });
            mpSalesEnabled.mockReturnValue(true);
            mpIsHandled.mockClear().mockResolvedValue(false);
            mpNeedsExecution.mockReturnValue(true);
            mpExecute.mockClear().mockResolvedValue({ done: [], failed: [] });
            mpMarkHandled.mockClear().mockResolvedValue(undefined);
            dryObservePosting.mockClear().mockResolvedValue(decision);
        });
        afterEach(() => {
            mpSalesEnabled.mockReturnValue(false);
            mpNeedsExecution.mockReturnValue(false);
            mpRecord.mockResolvedValue(true);
            mpIsHandled.mockResolvedValue(false);
            dryObservePosting.mockResolvedValue(null);
        });

        it('знакомое, но необработанное delivered-событие ретраится: решение исполняется и помечается', async () => {
            mpRecord.mockResolvedValue(false);

            await service.observeWideWindow();

            // 2 отправления в delivered; отмены (isNew=false) остаются наблюдением и не считаются
            expect(mpExecute).toHaveBeenCalledTimes(2);
            expect(mpExecute).toHaveBeenCalledWith(decision);
            expect(mpMarkHandled).toHaveBeenCalledWith(expect.objectContaining({ state: 'delivered' }));
            expect(mpMarkHandled).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled' }));
        });

        it('обработанное delivered-событие не пересчитывается', async () => {
            mpRecord.mockResolvedValue(false);
            mpIsHandled.mockResolvedValue(true);

            await service.observeWideWindow();

            expect(mpExecute).not.toHaveBeenCalled();
            expect(mpMarkHandled).not.toHaveBeenCalled();
        });

        it('решение без включённых действий — пометка без транзакции', async () => {
            mpNeedsExecution.mockReturnValue(false);

            await service.observeWideWindow();

            expect(mpExecute).not.toHaveBeenCalled();
            expect(mpMarkHandled).toHaveBeenCalledWith(expect.objectContaining({ state: 'delivered' }));
        });

        it('потолок прогона (решение null) → событие не помечается, возьмётся следующим проходом', async () => {
            dryObservePosting.mockResolvedValue(null);

            await service.observeWideWindow();

            expect(mpExecute).not.toHaveBeenCalled();
            expect(mpMarkHandled).not.toHaveBeenCalled();
        });

        it('сбой исполнения не помечает событие и не роняет прогон', async () => {
            mpExecute.mockRejectedValueOnce(new Error('DB down'));

            await service.observeWideWindow();

            expect(mpMarkHandled).toHaveBeenCalledTimes(1);
        });

        it('добор из журнала: осевшее delivered исполняется, хотя Ozon его больше не отдаёт', async () => {
            orderList.mockResolvedValue({ postings: [], has_next: false, cursor: '' });
            mpListUnhandled.mockResolvedValueOnce([
                { extId: '123-0001-1', posting: '123-0001-1', firstSeen: new Date('2026-07-20') },
            ]);

            await service.observeWideWindow();

            expect(mpListUnhandled).toHaveBeenCalledWith('OZON', 'POSTING_FBS', 'delivered');
            expect(dryObservePosting).toHaveBeenCalledWith('123-0001-1', 'FBS', 'delivered');
            expect(mpExecute).toHaveBeenCalledWith(decision);
            expect(mpMarkHandled).toHaveBeenCalledWith(
                expect.objectContaining({ extId: '123-0001-1', state: 'delivered' }),
            );
        });

        it('добор при выключенном флаге не ходит в журнал', async () => {
            mpSalesEnabled.mockReturnValue(false);
            orderList.mockResolvedValue({ postings: [], has_next: false, cursor: '' });

            await service.observeWideWindow();

            expect(mpListUnhandled).not.toHaveBeenCalled();
        });

        it('сбой добора не роняет прогон', async () => {
            orderList.mockResolvedValue({ postings: [], has_next: false, cursor: '' });
            mpListUnhandled.mockRejectedValueOnce(new Error('DB down'));

            await expect(service.observeWideWindow()).resolves.not.toThrow();
        });
    });

    describe('частичность возврата — числа берутся у Ozon (итерация 5)', () => {
        it('listReturnsByPosting фильтрует по posting_numbers[], а не по posting_number', async () => {
            ozonApiMethod.mockResolvedValueOnce({ returns: [{ id: 1 }, { id: 2 }] });

            const res = await service.listReturnsByPosting('72067989-0727-1');

            expect(res).toHaveLength(2);
            expect(ozonApiMethod).toHaveBeenCalledWith('/v1/returns/list', {
                filter: { posting_numbers: ['72067989-0727-1'] },
                limit: 500,
                last_id: 0,
            });
        });

        it('getPostingUnits считает единицы отправления по данным Ozon', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: { products: [{ quantity: 2 }, { quantity: 1 }] } });

            await expect(service.getPostingUnits('72067989-0727-1')).resolves.toBe(3);
            expect(ozonApiMethod).toHaveBeenCalledWith('/v3/posting/fbs/get', {
                posting_number: '72067989-0727-1',
            });
        });

        it('getPostingUnits НЕ лезет в нашу базу: там штуки с коэффициентом кратности', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: { products: [] } });

            await expect(service.getPostingUnits('72067989-0727-1')).resolves.toBeNull();
            expect(getByPosting).not.toHaveBeenCalled();
            expect(getInvoiceLines).not.toHaveBeenCalled();
        });

        it('ручка упала (FBO даёт 404) → null, о частичности не судим', async () => {
            ozonApiMethod.mockRejectedValueOnce(new Error('Unknown posting number'));

            await expect(service.getPostingUnits('33261943-0361-1')).resolves.toBeNull();
        });
    });

    it('test createInvoice', async () => {
        const posting = {
            posting_number: '321',
            status: 'string',
            in_process_at: date.toISOString(),
            products: [
                {
                    price: '1.11',
                    offer_id: '444',
                    quantity: 2,
                },
            ],
        };
        await service.createInvoice(posting, null);
        expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([24416, posting, null]);
    });

    it('test listReturns with pagination', async () => {
        const mockReturns = [
            { id: 1, posting_number: 'return-001', schema: 'Fbs', order_number: 'order-001' },
            { id: 2, posting_number: 'return-002', schema: 'Fbo', order_number: 'order-002' },
        ];

        ozonApiMethod.mockResolvedValueOnce({ returns: mockReturns, has_next: false });

        const result = await service.listReturns(7);

        expect(result).toEqual(mockReturns);
        // Итерация 4: фильтр по МОМЕНТУ СМЕНЫ СТАТУСА, а не по дате логистического возврата —
        // иначе переход MovingToOzon → ReturnedToOzon не виден, дата не меняется.
        // Начало окна даёт журнал (здесь мок отдаёт холодный старт на 7 дней).
        expect(ozonApiMethod).toHaveBeenCalledWith('/v1/returns/list', {
            filter: {
                visual_status_change_moment: {
                    time_from: DateTime.now().minus({ days: 7 }).startOf('day').toISO(),
                    time_to: DateTime.now().endOf('day').toISO(),
                },
            },
            limit: 500,
            last_id: 0,
        });
        expect(mpWindowStart).toHaveBeenCalledWith('OZON', 'RETURN', 7, 2);
    });

    describe('getByPostingNumber', () => {
        it('returns Ozon result when posting found', async () => {
            const posting = {
                posting_number: 'P-1',
                status: 'awaiting_packaging',
                in_process_at: date.toISOString(),
                products: [],
            };
            ozonApiMethod.mockResolvedValueOnce({ result: posting });

            const res = await service.getByPostingNumber('P-1');

            expect(res).toEqual(posting);
            expect(ozonApiMethod).toHaveBeenCalledWith('/v3/posting/fbs/get', { posting_number: 'P-1' });
            expect(getByPosting).not.toHaveBeenCalled();
        });

        it('returns null when Ozon empty and migration flag is OFF', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: null });

            const res = await service.getByPostingNumber('P-2');

            expect(res).toBeNull();
            expect(getByPosting).not.toHaveBeenCalled();
        });

        it('falls back to local invoice when Ozon empty and migration flag is ON', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockResolvedValueOnce({ result: null });
            getByPosting.mockResolvedValueOnce({ id: 8341, status: 1, date: '2026-05-08' });
            getInvoiceLines.mockResolvedValueOnce([
                { goodCode: '531557', whereOrdered: '', price: '739.00', quantity: 1 },
                { goodCode: '999', whereOrdered: 'cluster-A', price: '100.00', quantity: 2 },
            ]);

            const res = await service.getByPostingNumber('FBS-MIG-TEST-A');

            expect(res).toEqual({
                posting_number: 'FBS-MIG-TEST-A',
                status: '1',
                in_process_at: '2026-05-08',
                products: [
                    { price: '739.00', offer_id: '531557', quantity: 1 },
                    { price: '100.00', offer_id: '999-cluster-A', quantity: 2 },
                ],
            });
            expect(getByPosting).toHaveBeenCalledWith('FBS-MIG-TEST-A', null);
        });

        it('returns null when Ozon empty, flag ON, but no local invoice', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockResolvedValueOnce({ result: null });
            getByPosting.mockResolvedValueOnce(null);

            const res = await service.getByPostingNumber('FBS-UNKNOWN');

            expect(res).toBeNull();
            expect(getInvoiceLines).not.toHaveBeenCalled();
        });

        it('falls back when Ozon throws and migration flag is ON', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockRejectedValueOnce(new Error('Ozon 404'));
            getByPosting.mockResolvedValueOnce({ id: 8341, status: 1, date: '2026-05-08' });
            getInvoiceLines.mockResolvedValueOnce([
                { goodCode: '531557', whereOrdered: '', price: '739.00', quantity: 1 },
            ]);

            const res = await service.getByPostingNumber('FBS-MIG-TEST-A');

            expect(res?.posting_number).toBe('FBS-MIG-TEST-A');
            expect(res?.products).toHaveLength(1);
        });

        it('rethrows when Ozon throws and migration flag is OFF', async () => {
            ozonApiMethod.mockRejectedValueOnce(new Error('Ozon 500'));

            await expect(service.getByPostingNumber('P-X')).rejects.toThrow('Ozon 500');
            expect(getByPosting).not.toHaveBeenCalled();
        });
    });

    it('test listReturns with multiple pages', async () => {
        const page1 = [{ id: 1, posting_number: 'return-001', schema: 'Fbs', order_number: 'order-001' }];
        const page2 = [{ id: 2, posting_number: 'return-002', schema: 'Fbo', order_number: 'order-002' }];

        ozonApiMethod
            .mockResolvedValueOnce({ returns: page1, has_next: true })
            .mockResolvedValueOnce({ returns: page2, has_next: false });

        const result = await service.listReturns(7);

        expect(result).toEqual([...page1, ...page2]);
        expect(ozonApiMethod).toHaveBeenCalledTimes(2);
        expect(ozonApiMethod).toHaveBeenNthCalledWith(2, '/v1/returns/list', {
            filter: {
                visual_status_change_moment: {
                    time_from: DateTime.now().minus({ days: 7 }).startOf('day').toISO(),
                    time_to: DateTime.now().endOf('day').toISO(),
                },
            },
            limit: 500,
            last_id: 1,
        });
        // окно берётся один раз на весь пагинированный обход, а не на каждую страницу
        expect(mpWindowStart).toHaveBeenCalledTimes(1);
    });

    describe('submitFbsMarkCodes', () => {
        const invoice = { id: 8341, remark: 'P-1', buyerId: 24416 } as any;
        // Ответ validate «всё валидно» — вставляется в моки между /v3 get и set.
        const VALIDATE_OK = {
            products: [{ product_id: 999, valid: true, exemplars: [{ valid: true, marks: [{ valid: true }] }] }],
        };

        it('немаркированный (нет КМ): ГТД поштучно из подбора, марку не шлём, ship', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([]);
            getPickedPartiesGtdByScode.mockResolvedValueOnce([
                { realpricecode: 1, goodscode: '531557', quantity: 2, gtd: '10228010/260326/5094327' },
            ]);
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 2,
                            is_mandatory_mark_needed: false,
                            is_gtd_needed: true,
                            exemplars: [
                                { exemplar_id: 111, marks: [] },
                                { exemplar_id: 112, marks: [] },
                            ],
                        },
                    ],
                })
                .mockResolvedValueOnce({ result: { products: [{ offer_id: '531557', sku: 999 }] } })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockResolvedValueOnce({ result: ['P-1'] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, shipped: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                4,
                '/v6/fbs/posting/product/exemplar/set',
                expect.objectContaining({
                    products: [
                        {
                            product_id: 999,
                            exemplars: [
                                {
                                    exemplar_id: 111,
                                    marks: [],
                                    gtd: '10228010/260326/5094327',
                                    is_gtd_absent: false,
                                    is_rnpt_absent: true,
                                },
                                {
                                    exemplar_id: 112,
                                    marks: [],
                                    gtd: '10228010/260326/5094327',
                                    is_gtd_absent: false,
                                    is_rnpt_absent: true,
                                },
                            ],
                        },
                    ],
                }),
            );
        });

        it('is_mandatory_mark_needed=false (есть коды): марку не шлём, ГТД по КМ', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            getGtdByKi.mockResolvedValueOnce('10228010/260326/5094327');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: false,
                            is_gtd_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({ result: { products: [{ offer_id: '531557', sku: 999 }] } })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockResolvedValueOnce({ result: ['P-1'] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, shipped: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                4,
                '/v6/fbs/posting/product/exemplar/set',
                expect.objectContaining({
                    products: [
                        {
                            product_id: 999,
                            exemplars: [
                                {
                                    exemplar_id: 111,
                                    marks: [],
                                    gtd: '10228010/260326/5094327',
                                    is_gtd_absent: false,
                                    is_rnpt_absent: true,
                                },
                            ],
                        },
                    ],
                }),
            );
        });

        it('возвращает failed если все KM_FULL пусты', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce(null);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toEqual([{ ki: 'KI-1', reason: 'KM_FULL пуст' }]);
            expect(ozonApiMethod).not.toHaveBeenCalled();
        });

        it('happy path: createOrGet → getMap → set → poll done → ship → ok=true', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-MARK-1');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockResolvedValueOnce({ result: ['P-1'] });

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res).toEqual({ ok: true, shipped: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(1, '/v6/fbs/posting/product/exemplar/create-or-get', {
                posting_number: 'P-1',
            });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                3,
                '/v5/fbs/posting/product/exemplar/validate',
                expect.objectContaining({ posting_number: 'P-1' }),
            );
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                4,
                '/v6/fbs/posting/product/exemplar/set',
                expect.objectContaining({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            exemplars: [
                                {
                                    exemplar_id: 111,
                                    marks: [{ mark: '01FULL-MARK-1', mark_type: 'mandatory_mark' }],
                                    gtd: '',
                                    is_gtd_absent: true,
                                    is_rnpt_absent: true,
                                },
                            ],
                        },
                    ],
                }),
            );
            // теперь флоу шипит после ship_available
            expect(ozonApiMethod).toHaveBeenCalledWith(
                '/v4/posting/fbs/ship',
                expect.objectContaining({
                    posting_number: 'P-1',
                    packages: [{ products: [{ product_id: 999, quantity: 1, exemplar_ids: [111] }] }],
                }),
            );
        });

        it('validate вернул ошибку → стоп до set (failedStep=validate, set/ship не зовём)', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({ result: { products: [{ offer_id: '531557', sku: 999 }] } })
                .mockResolvedValueOnce({
                    products: [
                        {
                            product_id: 999,
                            valid: false,
                            exemplars: [{ valid: false, errors: ['GTD_MUST_BE_SPECIFIED_FOR_PRODUCT_COUNTRY'] }],
                        },
                    ],
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failedStep).toBe('validate');
            expect(res.failed).toContainEqual({
                ki: '*',
                reason: 'product 999: GTD_MUST_BE_SPECIFIED_FOR_PRODUCT_COUNTRY',
            });
            expect(ozonApiMethod).not.toHaveBeenCalledWith('/v6/fbs/posting/product/exemplar/set', expect.anything());
            expect(ozonApiMethod).not.toHaveBeenCalledWith('/v4/posting/fbs/ship', expect.anything());
        });

        it('ship упал → failedStep=ship, goToOzon=true', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({ result: { products: [{ offer_id: '531557', sku: 999 }] } })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockRejectedValueOnce(new Error('ship boom'));
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failedStep).toBe('ship');
            expect(res.goToOzon).toBe(true);
        });

        it('код-упаковка (quantity>1) на 1 экземпляр → успех, код уходит как есть', async () => {
            // Арт. …-3: Ozon продаёт 1 юнит (упаковку 3 шт), экземпляр один, код один количественный.
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-PACK', goodscode: '531557', realpricecode: 1, quantity: 3 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-PACK');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({ result: { products: [{ offer_id: '531557', sku: 999 }] } })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockResolvedValueOnce({ result: ['P-1'] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, shipped: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                4,
                '/v6/fbs/posting/product/exemplar/set',
                expect.objectContaining({
                    products: [
                        {
                            product_id: 999,
                            exemplars: [
                                {
                                    exemplar_id: 111,
                                    marks: [{ mark: '01FULL-PACK', mark_type: 'mandatory_mark' }],
                                    gtd: '',
                                    is_gtd_absent: true,
                                    is_rnpt_absent: true,
                                },
                            ],
                        },
                    ],
                }),
            );
        });

        it('число кодов ≠ числу экземпляров → failed', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 3 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL-1');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 2,
                            is_mandatory_mark_needed: true,
                            exemplars: [
                                { exemplar_id: 111, marks: [] },
                                { exemplar_id: 112, marks: [] },
                            ],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed[0].reason).toContain('привязано кодов 1');
        });

        it('мультипаки одного товара (569593-5 / 569593-10) → коды расходятся по своим product_id', async () => {
            // Живой кейс 0135585655-0073-1: раньше ключ по goodscode схлопывал обе позиции,
            // все 6 кодов уезжали в один product_id («привязано 6, ждёт 4» + «кодов нет»).
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-5A', goodscode: '569593', realpricecode: 1, quantity: 5 },
                { ki: 'KI-5B', goodscode: '569593', realpricecode: 1, quantity: 5 },
                { ki: 'KI-10A', goodscode: '569593', realpricecode: 2, quantity: 10 },
                { ki: 'KI-10B', goodscode: '569593', realpricecode: 2, quantity: 10 },
            ]);
            getKmFullByKi.mockImplementation(async (ki: string) => `01FULL-${ki}`);
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 3322439191,
                            quantity: 2,
                            is_mandatory_mark_needed: true,
                            exemplars: [
                                { exemplar_id: 111, marks: [] },
                                { exemplar_id: 112, marks: [] },
                            ],
                        },
                        {
                            product_id: 3322440371,
                            quantity: 2,
                            is_mandatory_mark_needed: true,
                            exemplars: [
                                { exemplar_id: 221, marks: [] },
                                { exemplar_id: 222, marks: [] },
                            ],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: {
                        products: [
                            { offer_id: '569593-5', sku: 3322439191 },
                            { offer_id: '569593-10', sku: 3322440371 },
                        ],
                    },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockResolvedValueOnce({ result: ['P-1'] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, shipped: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(
                4,
                '/v6/fbs/posting/product/exemplar/set',
                expect.objectContaining({
                    products: [
                        expect.objectContaining({
                            product_id: 3322439191,
                            exemplars: [
                                expect.objectContaining({
                                    marks: [{ mark: '01FULL-KI-5A', mark_type: 'mandatory_mark' }],
                                }),
                                expect.objectContaining({
                                    marks: [{ mark: '01FULL-KI-5B', mark_type: 'mandatory_mark' }],
                                }),
                            ],
                        }),
                        expect.objectContaining({
                            product_id: 3322440371,
                            exemplars: [
                                expect.objectContaining({
                                    marks: [{ mark: '01FULL-KI-10A', mark_type: 'mandatory_mark' }],
                                }),
                                expect.objectContaining({
                                    marks: [{ mark: '01FULL-KI-10B', mark_type: 'mandatory_mark' }],
                                }),
                            ],
                        }),
                    ],
                }),
            );
        });

        it('createOrGet вернул пустой ответ → skipRetry=true', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod.mockResolvedValueOnce({ result: null, error: { message: 'Not found' } });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.skipRetry).toBe(true);
        });

        it('goodscode не найден в posting → failed запись', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: 'WRONG', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toContainEqual({ ki: 'KI-1', reason: 'goodscode WRONG не найден в posting' });
        });

        it('poll status=ship_not_available → ok=false', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: true })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_not_available', products: [] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toContainEqual({
                ki: '*',
                reason: 'polling fail (last=ship_not_available)',
            });
        });

        it('set result=false, но статус ship_available → отгружаем (немаркир. кейс тоже), ok/shipped', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: false })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_available', products: [] })
                .mockResolvedValueOnce({ result: ['P-1'] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, shipped: true });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(5, '/v5/fbs/posting/product/exemplar/status', {
                posting_number: 'P-1',
            });
            expect(ozonApiMethod).toHaveBeenNthCalledWith(6, '/v4/posting/fbs/ship', expect.any(Object));
        });

        it('set result=false и статус ship_not_available → ok=false (polling fail), ship не делаем', async () => {
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            ozonApiMethod
                .mockResolvedValueOnce({
                    posting_number: 'P-1',
                    multi_box_qty: 1,
                    products: [
                        {
                            product_id: 999,
                            quantity: 1,
                            is_mandatory_mark_needed: true,
                            exemplars: [{ exemplar_id: 111, marks: [] }],
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    result: { products: [{ offer_id: '531557', sku: 999 }] },
                })
                .mockResolvedValueOnce(VALIDATE_OK)
                .mockResolvedValueOnce({ result: false })
                .mockResolvedValueOnce({ posting_number: 'P-1', status: 'ship_not_available', products: [] });
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed).toContainEqual({
                ki: '*',
                reason: 'polling fail (last=ship_not_available)',
            });
        });

        it('dry-run для FBS-MIG-* в development не вызывает Ozon', async () => {
            nodeEnv = 'development';
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'KI-1', goodscode: '531557', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValueOnce('01FULL');
            const res = await service.submitFbsMarkCodes({
                ...invoice,
                remark: 'FBS-MIG-TEST-A',
            });
            expect(res).toEqual({
                ok: true,
                dryRun: true,
                payload: {
                    posting_number: 'FBS-MIG-TEST-A',
                    marks: ['01FULL'],
                    failed: [],
                },
            });
            expect(ozonApiMethod).not.toHaveBeenCalled();
        });
    });

    describe('prepareFbsMarks', () => {
        it('create-or-get → строки с флагами марка/ГТД', async () => {
            ozonApiMethod.mockResolvedValueOnce({
                posting_number: 'P-9',
                multi_box_qty: 2,
                products: [
                    { product_id: 10, quantity: 1, is_mandatory_mark_needed: true, is_gtd_needed: true },
                    { product_id: 20, quantity: 3, is_mandatory_mark_needed: false },
                ],
            });

            const r = await service.prepareFbsMarks({ remark: 'P-9' } as any);

            expect(ozonApiMethod).toHaveBeenCalledWith('/v6/fbs/posting/product/exemplar/create-or-get', {
                posting_number: 'P-9',
            });
            expect(r).toEqual({
                ok: true,
                multiBoxQty: 2,
                lines: [
                    { productId: 10, quantity: 1, markNeeded: true, gtdNeeded: true },
                    { productId: 20, quantity: 3, markNeeded: false, gtdNeeded: true },
                ],
            });
        });

        it('пустой ответ → { ok: false, error }', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: null });
            const r = await service.prepareFbsMarks({ remark: 'P-9' } as any);
            expect(r).toEqual({ ok: false, error: 'createOrGet вернул пустой ответ' });
        });
    });

    describe('getShipmentLabel', () => {
        it('package-label → firstPageOnly (двухстраничный режется до одной)', async () => {
            const { PDFDocument } = await import('pdf-lib');
            const doc = await PDFDocument.create();
            doc.addPage([200, 200]);
            doc.addPage([200, 200]);
            ozonApiMethodBinary.mockResolvedValueOnce(Buffer.from(await doc.save()));
            (service as any).labelRetryDelaysMs = [0]; // без реальных пауз в тесте

            const out = await service.getShipmentLabel({ remark: 'P-9' } as any);

            expect(ozonApiMethodBinary).toHaveBeenCalledWith('/v2/posting/fbs/package-label', {
                posting_number: ['P-9'],
            });
            const parsed = await PDFDocument.load(out);
            expect(parsed.getPageCount()).toBe(1);
        });
    });

    describe('getShipmentBarcode', () => {
        it('/v3 get → barcodes.upper_barcode', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: { barcodes: { upper_barcode: 'SHK-42' } } });
            const r = await service.getShipmentBarcode({ remark: 'P-9' } as any);
            expect(ozonApiMethod).toHaveBeenCalledWith('/v3/posting/fbs/get', { posting_number: 'P-9' });
            expect(r).toBe('SHK-42');
        });

        it('нет barcodes → пустая строка', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: {} });
            const r = await service.getShipmentBarcode({ remark: 'P-9' } as any);
            expect(r).toBe('');
        });
    });
});
