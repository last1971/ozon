import { Test, TestingModule } from '@nestjs/testing';
import { PostingService } from './posting.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';
import { OzonApiService } from "../ozon.api/ozon.api.service";

describe('PostingService', () => {
    let service: PostingService;
    const create = jest.fn();
    const createInvoiceFromPostingDto = jest.fn();
    const commit = jest.fn();
    const getByPosting = jest.fn();
    const bulkSetStatus = jest.fn();
    const updatePrim = jest.fn();
    const ozonApiMethod = jest.fn();
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
    const orderList = jest.fn().mockResolvedValue({
        result: {
            postings,
        },
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
                        bulkSetStatus,
                        updatePrim,
                        getTransaction: () => ({ commit }),
                    },
                },
                { provide: ConfigService, useValue: { get: () => 24416 } },
                {
                    provide: ProductService,
                    useValue: { orderList },
                },
                {
                    provide: OzonApiService,
                    useValue: {
                        method: ozonApiMethod,
                    },
                }
            ],
        }).compile();

        orderList.mockClear();
        ozonApiMethod.mockClear();
        service = module.get<PostingService>(PostingService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test delivery list', async () => {
        const products = await service.listAwaitingDelivering();
        expect(products).toEqual(postings);
    });

    it('test packaging list', async () => {
        await service.listAwaitingPackaging();
        expect(orderList.mock.calls[0]).toEqual([
            {
                since: DateTime.now().minus({ day: 5 }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                status: 'awaiting_packaging',
            },
            100,
            0,
        ]);
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
        expect(ozonApiMethod).toHaveBeenCalledWith('/v1/returns/list', {
            filter: {
                logistic_return_date: {
                    time_from: DateTime.now().minus({ days: 7 }).startOf('day').toISO(),
                    time_to: DateTime.now().endOf('day').toISO(),
                },
            },
            limit: 500,
            last_id: 0,
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
                logistic_return_date: {
                    time_from: DateTime.now().minus({ days: 7 }).startOf('day').toISO(),
                    time_to: DateTime.now().endOf('day').toISO(),
                },
            },
            limit: 500,
            last_id: 1,
        });
    });
});
