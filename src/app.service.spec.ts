import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { GOOD_SERVICE } from './interfaces/IGood';
import { INVOICE_SERVICE } from './interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { ProductService } from './product/product.service';
import { StockType } from './product/stock.type';
import { VaultService } from 'vault-module/lib/vault.service';
import { PostingService } from './posting/posting.service';

describe('Test App', () => {
    let service: AppService;
    const updateCount = jest.fn().mockResolvedValue({ result: [] });
    const create = jest.fn();
    const date = new Date();
    const createInvoice = jest.fn().mockResolvedValue(1);
    const getByPosting = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(2);
    const pickupInvoice = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AppService,
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
                {
                    provide: GOOD_SERVICE,
                    useValue: {
                        in: async () => [
                            { code: 1, quantity: 1 },
                            { code: 2, quantity: 1 },
                        ],
                    },
                },
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        isExists: async (remark: string) => remark === '123',
                        create,
                        getByPosting,
                        pickupInvoice,
                    },
                },
                { provide: ConfigService, useValue: { get: () => 24416 } },
                { provide: VaultService, useValue: {} },
                {
                    provide: ProductService,
                    useValue: {
                        updateCount,
                        listWithCount: async (last_id: string) =>
                            last_id === ''
                                ? {
                                      result: {
                                          items: [
                                              {
                                                  offer_id: '1',
                                                  product_id: 1,
                                                  stocks: [{ type: StockType.FBS, present: 1, reserved: 0 }],
                                              },
                                              {
                                                  offer_id: '2',
                                                  product_id: 2,
                                                  stocks: [{ type: StockType.FBS, present: 0, reserved: 0 }],
                                              },
                                          ],
                                          last_id: '123',
                                          total: 2,
                                      },
                                  }
                                : { result: { last_id: '', items: [] } },
                        orderList: async () => ({
                            result: {
                                postings: [
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
                            },
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get<AppService>(AppService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test checkGoodCount', async () => {
        await service.checkGoodCount();
        expect(updateCount.mock.calls[0]).toEqual([[{ offer_id: '2', product_id: 2, stock: 1 }]]);
        expect(updateCount.mock.calls[1]).toEqual([[]]);
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
        ]);
        expect(createInvoice.mock.calls[1]).toEqual([
            {
                in_process_at: date,
                posting_number: '123',
                products: [],
                status: 'awaiting_packaging',
            },
        ]);
        expect(pickupInvoice.mock.calls).toEqual([[1], [2]]);
    });
});
