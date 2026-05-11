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
    const getInvoiceLines = jest.fn();
    const bulkSetStatus = jest.fn();
    const updatePrim = jest.fn();
    const ozonApiMethod = jest.fn();
    let markMigrationEnabled = false;
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
                        getInvoiceLines,
                        bulkSetStatus,
                        updatePrim,
                        getTransaction: () => ({ commit }),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string, def?: any) => {
                            if (key === 'OZON_BUYER_ID') return 24416;
                            if (key === 'MARK_CODES_ENABLED') return markMigrationEnabled;
                            return def;
                        },
                    },
                },
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
        getByPosting.mockReset();
        getInvoiceLines.mockReset();
        markMigrationEnabled = false;
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

    describe('getByPostingNumber', () => {
        it('returns Ozon result when posting found', async () => {
            const posting = { posting_number: 'P-1', status: 'awaiting_packaging', in_process_at: date.toISOString(), products: [] };
            ozonApiMethod.mockResolvedValueOnce({ result: posting });

            const res = await service.getByPostingNumber('P-1');

            expect(res).toEqual(posting);
            expect(ozonApiMethod).toHaveBeenCalledWith('/v3/posting/fbs/get', { posting_number: 'P-1' });
            expect(getByPosting).not.toHaveBeenCalled();
        });

        it('returns null when Ozon empty and migration flag is OFF', async () => {
            ozonApiMethod.mockResolvedValueOnce({ result: null });

            const res = await service.getByPostingNumber('P-2');

            expect(res).toBeNull();
            expect(getByPosting).not.toHaveBeenCalled();
        });

        it('falls back to local invoice when Ozon empty and migration flag is ON', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockResolvedValueOnce({ result: null });
            getByPosting.mockResolvedValueOnce({ id: 8341, status: 1, date: '2026-05-08' });
            getInvoiceLines.mockResolvedValueOnce([
                { goodCode: '531557', whereOrdered: '', price: '739.00', quantity: 1 },
                { goodCode: '999', whereOrdered: 'cluster-A', price: '100.00', quantity: 2 },
            ]);

            const res = await service.getByPostingNumber('FBS-MIG-TEST-A');

            expect(res).toEqual({
                posting_number: 'FBS-MIG-TEST-A',
                status: '1',
                in_process_at: '2026-05-08',
                products: [
                    { price: '739.00', offer_id: '531557', quantity: 1 },
                    { price: '100.00', offer_id: '999-cluster-A', quantity: 2 },
                ],
            });
            expect(getByPosting).toHaveBeenCalledWith('FBS-MIG-TEST-A', null);
        });

        it('returns null when Ozon empty, flag ON, but no local invoice', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockResolvedValueOnce({ result: null });
            getByPosting.mockResolvedValueOnce(null);

            const res = await service.getByPostingNumber('FBS-UNKNOWN');

            expect(res).toBeNull();
            expect(getInvoiceLines).not.toHaveBeenCalled();
        });

        it('falls back when Ozon throws and migration flag is ON', async () => {
            markMigrationEnabled = true;
            ozonApiMethod.mockRejectedValueOnce(new Error('Ozon 404'));
            getByPosting.mockResolvedValueOnce({ id: 8341, status: 1, date: '2026-05-08' });
            getInvoiceLines.mockResolvedValueOnce([
                { goodCode: '531557', whereOrdered: '', price: '739.00', quantity: 1 },
            ]);

            const res = await service.getByPostingNumber('FBS-MIG-TEST-A');

            expect(res?.posting_number).toBe('FBS-MIG-TEST-A');
            expect(res?.products).toHaveLength(1);
        });

        it('rethrows when Ozon throws and migration flag is OFF', async () => {
            ozonApiMethod.mockRejectedValueOnce(new Error('Ozon 500'));

            await expect(service.getByPostingNumber('P-X')).rejects.toThrow('Ozon 500');
            expect(getByPosting).not.toHaveBeenCalled();
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
