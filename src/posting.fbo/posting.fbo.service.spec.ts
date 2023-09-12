import { Test, TestingModule } from '@nestjs/testing';
import { PostingFboService } from './posting.fbo.service';
import { ProductService } from '../product/product.service';
import { ConfigService } from '@nestjs/config';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DateTime } from 'luxon';

describe('PostingFboService', () => {
    let service: PostingFboService;

    const orderFboList = jest.fn();
    const createInvoiceFromPostingDto = jest.fn();
    const commit = jest.fn();
    const getTransaction = () => ({ commit });
    const unPickupOzonFbo = jest.fn();
    const date = new Date();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PostingFboService,
                { provide: ProductService, useValue: { orderFboList } },
                { provide: ConfigService, useValue: { get: () => 123 } },
                {
                    provide: INVOICE_SERVICE,
                    useValue: { createInvoiceFromPostingDto, getTransaction, unPickupOzonFbo },
                },
            ],
        }).compile();

        service = module.get<PostingFboService>(PostingFboService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('list', async () => {
        orderFboList.mockResolvedValueOnce({ result: [] });
        await service.list('status');
        expect(orderFboList.mock.calls[0]).toEqual([
            {
                filter: {
                    since: DateTime.now().minus({ day: 2 }).startOf('day').toJSDate(),
                    status: 'status',
                    to: DateTime.now().endOf('day').toJSDate(),
                },
                limit: 1000,
                with: { analytics_data: true },
            },
        ]);
    });

    it('createInvoice', async () => {
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
            analytics_data: {
                warehouse_name: 'CENTER',
            },
        };
        await service.createInvoice(posting);
        expect(commit.mock.calls).toHaveLength(1);
        expect(unPickupOzonFbo.mock.calls[0]).toEqual([
            { offer_id: '444', price: '1.11', quantity: 2 },
            'CENTER',
            { commit },
        ]);
        expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([123, posting]);
    });
});
