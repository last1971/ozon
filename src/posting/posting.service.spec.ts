import { Test, TestingModule } from '@nestjs/testing';
import { PostingService } from './posting.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';

describe('PostingService', () => {
    let service: PostingService;
    const create = jest.fn();
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
                    },
                },
                { provide: ConfigService, useValue: { get: () => 24416 } },
                {
                    provide: ProductService,
                    useValue: { orderList },
                },
            ],
        }).compile();

        orderList.mockClear();
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
                since: DateTime.now().minus({ day: 2 }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                status: 'awaiting_packaging',
            },
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
        await service.createInvoice(posting);
        expect(create.mock.calls[0]).toEqual([
            {
                buyerId: 24416,
                date,
                remark: '321',
                invoiceLines: [
                    {
                        goodCode: '444',
                        price: '1.11',
                        quantity: 2,
                    },
                ],
            },
        ]);
    });
});
