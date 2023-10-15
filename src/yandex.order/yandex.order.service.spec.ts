import { Test, TestingModule } from '@nestjs/testing';
import { YandexOrderService, YandexOrderSubStatus } from './yandex.order.service';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ConfigService } from '@nestjs/config';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DateTime } from 'luxon';

describe('YandexOrderService', () => {
    let service: YandexOrderService;
    const method = jest.fn();
    const createInvoiceFromPostingDto = jest.fn();
    const getByBuyerAndStatus = jest.fn();
    const updateByCommissions = jest.fn();

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
                    useValue: { createInvoiceFromPostingDto, getByBuyerAndStatus, updateByCommissions },
                },
            ],
        }).compile();

        method.mockClear();
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
                posting_number: 125,
                products: [{ offer_id: '1111', price: 1.11, quantity: 6 }],
                status: 'HZ',
            },
        ]);
        expect(method.mock.calls[0]).toEqual([
            'campaigns/undefined/orders',
            'get',
            { status: 'PROCESSING', substatus: 'STARTED' },
        ]);
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
});
