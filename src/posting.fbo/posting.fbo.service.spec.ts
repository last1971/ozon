import { Test, TestingModule } from '@nestjs/testing';
import { PostingFboService } from './posting.fbo.service';
import { ProductService } from '../product/product.service';
import { ConfigService } from '@nestjs/config';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DateTime } from 'luxon';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FboInvoiceCreatorService } from './fbo-invoice-creator.service';
import { GoodServiceEnum } from '../good/good.service.enum';

describe('PostingFboService', () => {
    let service: PostingFboService;

    const orderFboList = jest.fn();
    const create = jest.fn();
    const emit = jest.fn();
    const date = new Date();

    let migrationEnabled = false;
    const configGet = (key: string, def?: unknown) => {
        if (key === 'MARK_CODES_ENABLED') return migrationEnabled;
        if (key === 'OZON_BUYER_ID') return 123;
        return def !== undefined ? def : 123;
    };

    beforeEach(async () => {
        migrationEnabled = false;
        create.mockReset();
        emit.mockReset();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PostingFboService,
                { provide: ProductService, useValue: { orderFboList } },
                { provide: ConfigService, useValue: { get: configGet } },
                { provide: INVOICE_SERVICE, useValue: {} },
                { provide: EventEmitter2, useValue: { emit } },
                { provide: FboInvoiceCreatorService, useValue: { create } },
            ],
        }).compile();

        orderFboList.mockClear();
        service = module.get<PostingFboService>(PostingFboService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('list', async () => {
        orderFboList.mockResolvedValueOnce({ postings: [], has_next: false, cursor: '' });
        await service.list('status');
        expect(orderFboList.mock.calls[0]).toEqual([
            {
                filter: {
                    since: DateTime.now().minus({ day: 2 }).startOf('day').toJSDate(),
                    statuses: ['status'],
                    to: DateTime.now().endOf('day').toJSDate(),
                },
                limit: 100,
                cursor: '',
                with: { analytics_data: true, financial_data: true },
            },
        ]);
    });

    it('listCanceled', async () => {
        orderFboList.mockResolvedValueOnce({ postings: [], has_next: false, cursor: '' });
        await service.listCanceled();
        expect(orderFboList.mock.calls[0][0].filter.statuses).toEqual(['cancelled']);
    });

    it('пагинация курсором: собирает страницы, помечает isFbo, передаёт курсор', async () => {
        orderFboList.mockResolvedValueOnce({
            postings: [{ posting_number: 'A' }],
            has_next: true,
            cursor: 'CUR1',
        });
        orderFboList.mockResolvedValueOnce({
            postings: [{ posting_number: 'B' }],
            has_next: false,
            cursor: '',
        });

        const res = await service.list('cancelled');

        expect(res).toEqual([
            { posting_number: 'A', isFbo: true },
            { posting_number: 'B', isFbo: true },
        ]);
        expect(orderFboList).toHaveBeenCalledTimes(2);
        expect(orderFboList.mock.calls[0][0].cursor).toBe('');
        expect(orderFboList.mock.calls[1][0].cursor).toBe('CUR1');
    });

    it('пагинация курсором: не зацикливается на повторном курсоре', async () => {
        orderFboList.mockResolvedValue({
            postings: [{ posting_number: 'A' }],
            has_next: true,
            cursor: 'SAME',
        });

        const res = await service.list('cancelled');

        expect(orderFboList).toHaveBeenCalledTimes(2);
        expect(res).toHaveLength(2);
    });

    describe('createInvoice → делегирует в creator с контекстом Ozon', () => {
        const posting = {
            posting_number: '321',
            status: 's',
            in_process_at: date.toISOString(),
            products: [{ price: '1.11', offer_id: '444', quantity: 2 }],
            analytics_data: { warehouse_name: 'CENTER' },
            financial_data: { cluster_from: 'CLUSTER' },
        };

        it('legacy (flag off): prims [warehouse, cluster, suffix], primLabel=cluster, флаги Ozon', async () => {
            create.mockResolvedValueOnce({ id: 999 });
            const res = await service.createInvoice(posting as any, null);

            expect(res).toEqual({ id: 999 });
            const ctx = create.mock.calls[0][0];
            expect(ctx.service).toBe(GoodServiceEnum.OZON);
            expect(ctx.posting).toBe(posting);
            expect(ctx.prims).toEqual(['CENTER', 'CLUSTER', 'отмена FBO']);
            expect(ctx.primLabel).toBe('CLUSTER');
            expect(ctx.buyerId).toBe(123);
            expect(ctx.useMigration).toBe(false);
            expect(ctx.setIgkNot1c).toBe(true);
            expect(ctx.pickupAfterCreate).toBe(false);
            expect(ctx.skipIfNoPodbor).toBe(false);
            expect(ctx.transaction).toBe(null);
        });

        it('migration (flag on): useMigration=true', async () => {
            migrationEnabled = true;
            create.mockResolvedValueOnce({ id: 1 });
            await service.createInvoice(posting as any, null);
            expect(create.mock.calls[0][0].useMigration).toBe(true);
        });

        it('недостача → creator вернул null → createInvoice отдаёт null', async () => {
            create.mockResolvedValueOnce(null);
            expect(await service.createInvoice(posting as any, null)).toBeNull();
        });
    });
});
