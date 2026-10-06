import { Test, TestingModule } from '@nestjs/testing';
import { YandexOrderService, YandexOrderSubStatus } from './yandex.order.service';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ConfigService } from '@nestjs/config';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DateTime } from 'luxon';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';

describe('YandexOrderService', () => {
    let service: YandexOrderService;
    const method = jest.fn();
    const createInvoiceFromPostingDto = jest.fn();
    const getByBuyerAndStatus = jest.fn();
    const updateByCommissions = jest.fn();
    const getAttachedMarkCodesByScode = jest.fn();
    const getKmFullByKi = jest.fn();
    const record = jest.fn();
    const listUnhandled = jest.fn();
    const salesEnabled = jest.fn();
    const observePosting = jest.fn();
    const handleDelivered = jest.fn();
    const flush = jest.fn();

    const invoice: any = { id: 77, remark: '61062457474', buyerId: 2222 };
    const startedOrder = (items: any[]) => ({
        order: {
            id: 61062457474,
            status: 'PROCESSING',
            substatus: 'STARTED',
            creationDate: '16-07-2023 11:35:08',
            items,
        },
    });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                YandexOrderService,
                {
                    provide: YandexApiService,
                    useValue: { method },
                },
                {
                    provide: VaultService,
                    useValue: { get: async () => ({ 'electronica-company': 445 }) },
                },
                {
                    provide: ConfigService,
                    useValue: { get: () => 2222 },
                },
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        createInvoiceFromPostingDto,
                        getByBuyerAndStatus,
                        updateByCommissions,
                        getAttachedMarkCodesByScode,
                        getKmFullByKi,
                    },
                },
                { provide: MpEventService, useValue: { record, listUnhandled } },
                {
                    provide: MpDecisionRunnerService,
                    useValue: { salesEnabled, observePosting, handleDelivered, flush },
                },
            ],
        }).compile();

        // reset, не clear: непотреблённые mockResolvedValueOnce иначе утекают в следующий тест.
        jest.resetAllMocks();
        service = module.get<YandexOrderService>(YandexOrderService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    it('test list', async () => {
        method.mockResolvedValueOnce({
            orders: [
                {
                    id: 125,
                    substatus: 'HZ',
                    creationDate: '16-07-2023 11:35:08',
                    items: [
                        {
                            priceBeforeDiscount: 1.11,
                            offerId: '1111',
                            count: 6,
                        },
                    ],
                },
            ],
        });
        const res = await service.list(YandexOrderSubStatus.STARTED);
        expect(res).toEqual([
            {
                in_process_at: DateTime.fromFormat('16-07-2023 11:35:08', 'dd-LL-y HH:mm:ss').toJSDate().toString(),
                // строго СТРОКА: числовой order.id ломал дедуп (дубли счетов 14.08.2026)
                posting_number: '125',
                products: [{ offer_id: '1111', price: 1.11, quantity: 6 }],
                status: 'HZ',
            },
        ]);
        expect(method.mock.calls[0]).toEqual([
            'campaigns/undefined/orders',
            'get',
            { status: 'PROCESSING', substatus: 'STARTED', limit: 50 },
        ]);
    });
    it('list идёт по страницам pageToken', async () => {
        method
            .mockResolvedValueOnce({
                orders: [{ id: 1, items: [], creationDate: '16-07-2023 11:35:08' }],
                paging: { nextPageToken: 'p2' },
            })
            .mockResolvedValueOnce({ orders: [{ id: 2, items: [], creationDate: '16-07-2023 11:35:08' }], paging: {} });
        const res = await service.list(null);
        expect(res.map((p) => p.posting_number)).toEqual(['1', '2']);
        expect(method.mock.calls[1][2]).toEqual({ status: 'PROCESSING', limit: 50, pageToken: 'p2' });
    });
    it('test createInvoice', async () => {
        const date = new Date();
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
        expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([2222, posting, null]);
    });
    it('statsOrder', async () => {
        method
            .mockResolvedValueOnce({ result: { orders: [1], paging: { nextPageToken: 'next' } } })
            .mockResolvedValueOnce({ result: { orders: [], paging: {} } });
        await service.statsOrder({ orders: [1, 2], statuses: ['first', 'second'] });
        expect(method.mock.calls).toHaveLength(2);
        expect(method.mock.calls[1]).toEqual([
            'campaigns/undefined/stats/orders?page_token=next',
            'post',
            { orders: [1, 2], statuses: ['first', 'second'] },
        ]);
    });
    it('updateTransactions', async () => {
        getByBuyerAndStatus.mockResolvedValueOnce([{ remark: '123' }, { remark: '124' }]);
        method
            .mockResolvedValueOnce({
                result: {
                    orders: [
                        {
                            partnerOrderId: '123',
                            payments: [{ total: 123 }],
                            commissions: [{ actual: 1 }, { actual: 2 }],
                        },
                        {
                            partnerOrderId: '124',
                            payments: [{ total: 124 }],
                            commissions: [{ actual: 3 }, { actual: 4 }],
                        },
                    ],
                    paging: {},
                },
            })
            .mockResolvedValueOnce({ result: { orders: [], paging: {} } });
        await service.updateTransactions();
        expect(updateByCommissions.mock.calls[0]).toEqual([
            new Map([
                ['123', 120],
                ['124', 117],
            ]),
            null,
        ]);
    });

    describe('getByPostingNumber', () => {
        it('заказ по номеру через getOrder', async () => {
            method.mockResolvedValueOnce(
                startedOrder([{ id: 9, offerId: '552601', count: 2, priceBeforeDiscount: 5 }]),
            );
            const res = await service.getByPostingNumber('61062457474');
            expect(method.mock.calls[0][0]).toBe('campaigns/undefined/orders/61062457474');
            expect(res.posting_number).toBe('61062457474');
            expect(res.products).toEqual([{ offer_id: '552601', price: 5, quantity: 2 }]);
        });
        it('нечисловой номер и NotOk → null', async () => {
            expect(await service.getByPostingNumber('abc')).toBeNull();
            method.mockResolvedValueOnce({ status: 'NotOk', error: { message: 'x' } });
            expect(await service.getByPostingNumber('123')).toBeNull();
        });
    });

    describe('prepareFbsMarks', () => {
        it('markNeeded только по CIS, CIS_OPTIONAL — нет', async () => {
            method.mockResolvedValueOnce(
                startedOrder([
                    { id: 1, offerId: 'a', count: 1, requiredInstanceTypes: ['CIS'] },
                    { id: 2, offerId: 'b', count: 1, requiredInstanceTypes: ['CIS_OPTIONAL'] },
                    { id: 3, offerId: 'c', count: 1 },
                ]),
            );
            const res = await service.prepareFbsMarks(invoice);
            expect(res.ok).toBe(true);
            expect(res.lines.map((l) => l.markNeeded)).toEqual([true, false, false]);
        });
    });

    describe('submitFbsMarkCodes', () => {
        it('коды по позициям → boxes → status', async () => {
            method
                .mockResolvedValueOnce(
                    startedOrder([
                        { id: 11, offerId: '552601', count: 2, requiredInstanceTypes: ['CIS'] },
                        { id: 12, offerId: '539090', count: 1 },
                    ]),
                )
                .mockResolvedValueOnce({ status: 'OK' }) // boxes
                .mockResolvedValueOnce({ status: 'OK' }); // status
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '552601', realpricecode: 1, quantity: 1 },
                { ki: 'k2', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockImplementation(async (ki: string) => `${ki}-full`);

            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, shipped: true });
            expect(method.mock.calls[1]).toEqual([
                'campaigns/undefined/orders/61062457474/boxes',
                'put',
                {
                    boxes: [
                        {
                            items: [
                                { id: 11, fullCount: 2, instances: [{ cis: 'k1-full' }, { cis: 'k2-full' }] },
                                { id: 12, fullCount: 1 },
                            ],
                        },
                    ],
                },
            ]);
            expect(method.mock.calls[2]).toEqual([
                'campaigns/undefined/orders/61062457474/status',
                'put',
                { order: { status: 'PROCESSING', substatus: 'READY_TO_SHIP' } },
            ]);
        });
        it('мультипак: код-упаковка QUANTITY=3 уходит в позицию 552601-3', async () => {
            method
                .mockResolvedValueOnce(
                    startedOrder([
                        { id: 21, offerId: '552601-3', count: 1 },
                        { id: 22, offerId: '552601', count: 1 },
                    ]),
                )
                .mockResolvedValueOnce({ status: 'OK' })
                .mockResolvedValueOnce({ status: 'OK' });
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'p', goodscode: '552601', realpricecode: 1, quantity: 3 },
                { ki: 's', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockImplementation(async (ki: string) => `${ki}-full`);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(true);
            expect(method.mock.calls[1][2].boxes[0].items).toEqual([
                { id: 21, fullCount: 1, instances: [{ cis: 'p-full' }] },
                { id: 22, fullCount: 1, instances: [{ cis: 's-full' }] },
            ]);
        });
        it('кодов меньше, чем единиц — ничего не шлём', async () => {
            method.mockResolvedValueOnce(startedOrder([{ id: 11, offerId: '552601', count: 2 }]));
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValue('k1-full');
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failedStep).toBe('validate');
            expect(res.failed[0].reason).toContain('привязано кодов 1, Яндекс ждёт 2');
            expect(method).toHaveBeenCalledTimes(1);
        });
        it('Яндекс требует CIS, кодов нет — провал до отправки', async () => {
            method.mockResolvedValueOnce(
                startedOrder([{ id: 11, offerId: '552601', count: 1, requiredInstanceTypes: ['CIS'] }]),
            );
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '999', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValue('k1-full');
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failed.map((f) => f.reason)).toEqual([
                'goodscode 999 не найден в заказе',
                'позиция 552601: Яндекс требует КМ, а кодов нет',
            ]);
            expect(method).toHaveBeenCalledTimes(1);
        });
        it('немаркированный заказ: boxes не трогаем, только статус', async () => {
            method
                .mockResolvedValueOnce(startedOrder([{ id: 11, offerId: '552601', count: 1 }]))
                .mockResolvedValueOnce({ status: 'OK' });
            getAttachedMarkCodesByScode.mockResolvedValueOnce([]);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res).toEqual({ ok: true, shipped: true });
            expect(method).toHaveBeenCalledTimes(2);
            expect(method.mock.calls[1][0]).toBe('campaigns/undefined/orders/61062457474/status');
        });
        it('статус не встал после boxes → goToOzon (разбор в ЛК)', async () => {
            method
                .mockResolvedValueOnce(startedOrder([{ id: 11, offerId: '552601', count: 1 }]))
                .mockResolvedValueOnce({ status: 'OK' })
                .mockResolvedValueOnce({
                    status: 'NotOk',
                    error: { status: 400, message: 'BAD_REQUEST: cis invalid' },
                });
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValue('k1-full');
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.failedStep).toBe('status');
            expect(res.goToOzon).toBe(true);
            expect(res.failed[0].reason).toContain('cis invalid');
        });
        it('Яндекс ещё проверяет коды в ЧЗ → ждём и повторяем статус, потом ok', async () => {
            YandexOrderService.STATUS_POLL_DELAYS_MS = [0, 0];
            const pending = {
                status: 'NotOk',
                error: {
                    status: 400,
                    message:
                        'STATUS_NOT_ALLOWED: Transition PROCESSING -> PROCESSING is not allowed. ' +
                        'Reason: Cis validation is not finished for items with cargo type 980, 985, 990.',
                },
            };
            method
                .mockResolvedValueOnce(startedOrder([{ id: 11, offerId: '552601', count: 1 }]))
                .mockResolvedValueOnce({ status: 'OK' })
                .mockResolvedValueOnce(pending)
                .mockResolvedValueOnce(pending)
                .mockResolvedValueOnce({ status: 'OK' });
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValue('k1-full');

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res).toEqual({ ok: true, shipped: true });
            expect(method.mock.calls.filter((c) => String(c[0]).endsWith('/status'))).toHaveLength(3);
        });

        it('проверка ЧЗ не закончилась за всё ожидание → «нажмите ещё раз», в ЛК не гоним', async () => {
            YandexOrderService.STATUS_POLL_DELAYS_MS = [0];
            const pending = {
                status: 'NotOk',
                error: { status: 400, message: 'STATUS_NOT_ALLOWED: Cis validation is not finished for items' },
            };
            method
                .mockResolvedValueOnce(startedOrder([{ id: 11, offerId: '552601', count: 1 }]))
                .mockResolvedValueOnce({ status: 'OK' })
                .mockResolvedValue(pending);
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            getKmFullByKi.mockResolvedValue('k1-full');

            const res = await service.submitFbsMarkCodes(invoice);

            expect(res.ok).toBe(false);
            expect(res.failedStep).toBe('status');
            expect(res.goToOzon).toBe(false);
            expect(res.failed[0].reason).toContain('ещё раз через минуту');
        });

        it('заказ уже READY_TO_SHIP и коды у Яндекса есть → ok/skipped', async () => {
            method.mockResolvedValueOnce({
                order: {
                    id: 61062457474,
                    status: 'PROCESSING',
                    substatus: 'READY_TO_SHIP',
                    creationDate: '16-07-2023 11:35:08',
                    items: [{ id: 11, offerId: '552601', count: 1, instances: [{ cis: 'x' }] }],
                },
            });
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(true);
            expect(res.skipped).toContain('READY_TO_SHIP');
            expect(method).toHaveBeenCalledTimes(1);
        });
        it('заказ уже READY_TO_SHIP, а кодов у Яндекса нет → провал без ретрая', async () => {
            method.mockResolvedValueOnce({
                order: {
                    id: 61062457474,
                    status: 'PROCESSING',
                    substatus: 'READY_TO_SHIP',
                    creationDate: '16-07-2023 11:35:08',
                    items: [{ id: 11, offerId: '552601', count: 1 }],
                },
            });
            getAttachedMarkCodesByScode.mockResolvedValueOnce([
                { ki: 'k1', goodscode: '552601', realpricecode: 1, quantity: 1 },
            ]);
            const res = await service.submitFbsMarkCodes(invoice);
            expect(res.ok).toBe(false);
            expect(res.skipRetry).toBe(true);
        });
    });

    describe('observeYandexFbs', () => {
        it('новые delivered → handleDelivered, старые пропускаются, хвост добирается', async () => {
            (service as any).configService = { get: () => ['yandex'] };
            method.mockResolvedValueOnce({ orders: [{ id: 1 }, { id: 2 }], paging: {} });
            record.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
            salesEnabled.mockReturnValue(true);
            listUnhandled.mockResolvedValueOnce([{ extId: '3', posting: '3' }]);
            await service.observeYandexFbs();
            expect(method.mock.calls[0][2]).toMatchObject({ status: 'DELIVERED', limit: 50 });
            expect(method.mock.calls[0][2].updatedAtFrom).toBeDefined();
            expect(handleDelivered.mock.calls.map((c) => c[0].extId)).toEqual(['1', '3']);
            expect(handleDelivered.mock.calls[0][0]).toMatchObject({
                service: 'YANDEX',
                kind: 'POSTING_FBS',
                state: 'delivered',
            });
            expect(flush).toHaveBeenCalledWith('observeYandexFbs');
        });
        it('продажи выключены → только наблюдение', async () => {
            (service as any).configService = { get: () => ['yandex'] };
            method.mockResolvedValueOnce({ orders: [{ id: 1 }], paging: {} });
            record.mockResolvedValueOnce(true);
            salesEnabled.mockReturnValue(false);
            await service.observeYandexFbs();
            expect(observePosting).toHaveBeenCalledWith('1', 'FBS', 'delivered', undefined, 'YANDEX');
            expect(handleDelivered).not.toHaveBeenCalled();
        });
        it('Яндекс не включён → ни одного запроса', async () => {
            (service as any).configService = { get: () => ['ozon'] };
            await service.observeYandexFbs();
            expect(method).not.toHaveBeenCalled();
        });
    });
});
