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
                        updatePrim,
                        update: jest.fn(),
                        isExists: async (remark: string) => remark === '123' || remark === '111',
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
                        listAwaitingPackaging: () => [],
                        listAwaitingDelivering: () => [],
                        listCanceled: () => [],
                    },
                },
                {
                    provide: PostingService,
                    useValue: {
                        constructor: { name: 'PostingService' },
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
            [{ posting_number: '111'}, { commit }],
            [1, { commit }],
            [2, { commit }],
        ]);
        expect(updatePrim.mock.calls[0]).toEqual([
           '111',
           '111 отмена FBO',
            { commit },
        ]);
        expect(commit.mock.calls).toHaveLength(4);
    });*/

    it('should return PostingService when name is GoodServiceEnum.PostingService', () => {
        const result = service.getServiceByName(GoodServiceEnum.OZON);
        expect(result).toBeDefined();
        expect(result.constructor.name).toBe('PostingService');
    });

    it('should return null when name is not a valid GoodServiceEnum value', () => {
        const result = service.getServiceByName(GoodServiceEnum.EXPRESS);
        expect(result).toBeNull();
    });
});
