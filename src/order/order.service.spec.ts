import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from './order.service';
import { ProductService } from '../product/product.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { PostingService } from '../posting/posting.service';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';

describe('OrderService', () => {
    let service: OrderService;
    const getTransactionList = jest.fn().mockResolvedValue([]);
    const updateByTransactions = jest.fn();
    const createInvoice = jest.fn().mockResolvedValue(1);
    const getByPosting = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(2);
    const pickupInvoice = jest.fn();
    const commit = jest.fn();
    const getTransaction = () => ({ commit });
    const date = new Date();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrderService,
                { provide: ProductService, useValue: { getTransactionList } },
                { provide: ConfigService, useValue: { get: () => Object.values(GoodServiceEnum) } },
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        getTransaction,
                        updateByTransactions,
                        getByPosting,
                        pickupInvoice,
                        isExists: async (remark: string) => remark === '123',
                    },
                },
                {
                    provide: YandexOrderService,
                    useValue: {
                        createInvoice,
                        listAwaitingPackaging: () => [],
                        listAwaitingDelivering: () => [],
                    },
                },
                {
                    provide: PostingFboService,
                    useValue: {
                        createInvoice,
                        listAwaitingPackaging: () => [],
                        listAwaitingDelivering: () => [],
                    },
                },
                {
                    provide: WbOrderService,
                    useValue: {
                        createInvoice,
                        listAwaitingPackaging: () => [],
                        listAwaitingDelivering: () => [],
                    },
                },
                {
                    provide: PostingService,
                    useValue: {
                        createInvoice,
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
                    },
                },
            ],
        }).compile();

        service = module.get<OrderService>(OrderService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test updateTransactions', async () => {
        const dto = {
            date: {
                from: new Date('2023-06-16'),
                to: new Date('2023-06-16'),
            },
            transaction_type: 'orders',
        };
        await service.updateTransactions(dto);
        expect(getTransactionList.mock.calls).toHaveLength(1);
        expect(updateByTransactions.mock.calls).toHaveLength(1);
        expect(getTransactionList.mock.calls[0]).toEqual([dto]);
        expect(updateByTransactions.mock.calls[0]).toEqual([[], null]);
    });

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
            { commit },
        ]);
        expect(createInvoice.mock.calls[1]).toEqual([
            {
                in_process_at: date,
                posting_number: '123',
                products: [],
                status: 'awaiting_packaging',
            },
            { commit },
        ]);
        expect(pickupInvoice.mock.calls).toEqual([
            [1, { commit }],
            [2, { commit }],
        ]);
        expect(commit.mock.calls).toHaveLength(4);
    });
});
