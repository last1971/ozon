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
                    useValue: { createInvoiceFromPostingDto },
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
        await service.createInvoice(posting);
        expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([2222, posting]);
    });
});
