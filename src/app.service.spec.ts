import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { GOOD_SERVICE } from './interfaces/IGood';
import { INVOICE_SERVICE } from './interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { ProductService } from './product/product.service';
import { StockType } from './product/stock.type';
import { VaultService } from './vault/vault.service';

describe('Test App', () => {
    let service: AppService;
    const updateCount = jest.fn().mockResolvedValue({ result: [] });
    const create = jest.fn();
    const date = new Date();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AppService,
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
                                                  stocks: [{ type: StockType.FBS, present: 1 }],
                                              },
                                              {
                                                  offer_id: '2',
                                                  product_id: 2,
                                                  stocks: [{ type: StockType.FBS, present: 0 }],
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
