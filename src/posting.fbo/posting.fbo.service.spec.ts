import { Test, TestingModule } from '@nestjs/testing';
import { PostingFboService } from './posting.fbo.service';
import { FboMarkMigrationService } from './fbo-mark-migration.service';
import { ProductService } from '../product/product.service';
import { ConfigService } from '@nestjs/config';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DateTime } from 'luxon';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('PostingFboService', () => {
    let service: PostingFboService;

    const orderFboList = jest.fn();
    const createInvoiceFromPostingDto = jest.fn();
    const commit = jest.fn();
    const getTransaction = () => ({ commit });
    const unPickupOzonFbo = jest.fn();
    const isExists = jest.fn();
    const getByPosting = jest.fn();
    const pickupInvoice = jest.fn();
    const updatePrim = jest.fn();
    const deltaGood = jest.fn();
    const findFboPodbposCandidates = jest.fn();
    const findLiveMigratableCodes = jest.fn();
    const migrateMarkCode = jest.fn();
    const migratePodbpos = jest.fn();
    const clearInvoiceReserve = jest.fn();
    const findRealpriceCodes = jest.fn();
    const getStorageSS = jest.fn();
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
        [
            unPickupOzonFbo,
            createInvoiceFromPostingDto,
            emit,
            deltaGood,
            findFboPodbposCandidates,
            findLiveMigratableCodes,
            migrateMarkCode,
            migratePodbpos,
            clearInvoiceReserve,
            findRealpriceCodes,
            getStorageSS,
        ].forEach((m) => m.mockReset());
        getStorageSS.mockReturnValue(1);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PostingFboService,
                FboMarkMigrationService,
                { provide: ProductService, useValue: { orderFboList } },
                { provide: ConfigService, useValue: { get: configGet } },
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        createInvoiceFromPostingDto,
                        getTransaction,
                        unPickupOzonFbo,
                        isExists,
                        getByPosting,
                        pickupInvoice,
                        updatePrim,
                        update: jest.fn(),
                        deltaGood,
                        findFboPodbposCandidates,
                        findLiveMigratableCodes,
                        migrateMarkCode,
                        migratePodbpos,
                        clearInvoiceReserve,
                        findRealpriceCodes,
                        getStorageSS,
                    },
                },
                {
                    provide: EventEmitter2,
                    useValue: { emit },
                },
            ],
        }).compile();

        orderFboList.mockClear();
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
                with: { analytics_data: true, financial_data: true },
            },
        ]);
    });

    it('listCanceled', async () => {
        orderFboList.mockResolvedValueOnce({ result: [] });
        await service.listCanceled();
        expect(orderFboList.mock.calls[0]).toEqual([
            {
                filter: {
                    since: DateTime.now().minus({ day: 90 }).startOf('day').toJSDate(),
                    status: 'cancelled',
                    to: DateTime.now().endOf('day').toJSDate(),
                },
                limit: 1000,
                with: { analytics_data: true, financial_data: true },
            },
        ]);
    });

    describe('createInvoice — legacy (flag off)', () => {
        it('warehouse_name match — простой случай', async () => {
            const posting = {
                posting_number: '321',
                status: 'string',
                in_process_at: date.toISOString(),
                products: [{ price: '1.11', offer_id: '444', quantity: 2 }],
                analytics_data: { warehouse_name: 'CENTER' },
            };
            unPickupOzonFbo.mockResolvedValueOnce(true);
            await service.createInvoice(posting, null);
            expect(unPickupOzonFbo.mock.calls[0]).toEqual([
                { offer_id: '444', price: '1.11', quantity: 2 },
                'CENTER',
                null,
            ]);
            expect(createInvoiceFromPostingDto.mock.calls[0]).toEqual([123, posting, null]);
            expect(findFboPodbposCandidates).not.toHaveBeenCalled();
        });

        it('cluster_from fallback', async () => {
            const posting = {
                posting_number: '321',
                status: 'string',
                in_process_at: date.toISOString(),
                products: [{ price: '1.11', offer_id: '444', quantity: 2 }],
                analytics_data: { warehouse_name: 'ПУШКИНО_1_РФЦ' },
                financial_data: { cluster_from: 'Москва, МО и Дальние регионы' },
            };
            unPickupOzonFbo.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
            await service.createInvoice(posting, null);
            expect(unPickupOzonFbo).toHaveBeenCalledTimes(2);
            expect(unPickupOzonFbo.mock.calls[0][1]).toBe('ПУШКИНО_1_РФЦ');
            expect(unPickupOzonFbo.mock.calls[1][1]).toBe('Москва, МО и Дальние регионы');
            expect(emit).not.toHaveBeenCalled();
        });

        it('все три попытки провалились → deltaGood + одно письмо о недостаче', async () => {
            const posting = {
                posting_number: '321',
                status: 'string',
                in_process_at: date.toISOString(),
                products: [{ price: '1.11', offer_id: '444', quantity: 2 }],
                analytics_data: { warehouse_name: 'КЕМЕРОВО_РФЦ' },
                financial_data: { cluster_from: 'Новосибирск' },
            };
            unPickupOzonFbo.mockResolvedValue(false);
            await service.createInvoice(posting, null);
            expect(unPickupOzonFbo).toHaveBeenCalledTimes(3);
            expect(deltaGood).toHaveBeenCalledTimes(1);
            expect(deltaGood.mock.calls[0]).toEqual(['444', 2, 'Новосибирск', null]);
            expect(emit).toHaveBeenCalledTimes(1);
            const [evt, subject, body] = emit.mock.calls[0];
            expect(evt).toBe('error.message');
            expect(subject).toBe('Ozon FBO: нет позиции — создана недостача');
            expect(body).toContain('Posting: 321');
            expect(body).toContain('GOODSCODE: 444, qty: 2');
            expect(body).toContain('warehouse_name: КЕМЕРОВО_РФЦ');
            expect(body).toContain('cluster_from:   Новосибирск');
        });
    });

    describe('createInvoice — mark migration (flag on)', () => {
        const cand = (podbposcode: number, scode: number, rpc: number, quanAvail: number, prim: string) => ({
            podbposcode,
            scode,
            realpricecode: rpc,
            quanAvail,
            prim,
            cntNom: 0,
            cntLive: 0,
            cntTt3: 0,
        });

        beforeEach(() => {
            migrationEnabled = true;
            createInvoiceFromPostingDto.mockImplementation((buyerId, posting) =>
                Promise.resolve({
                    id: 999,
                    status: 3,
                    invoiceLines: posting.products.map((p, i) => ({
                        goodCode: p.offer_id.replace(/-.*/g, ''),
                        quantity: p.quantity,
                        price: p.price,
                        realpricecode: 300 + i,
                    })),
                }),
            );
            findLiveMigratableCodes.mockResolvedValue([]);
            migratePodbpos.mockResolvedValue(undefined);
            clearInvoiceReserve.mockResolvedValue(undefined);
        });

        const buildPosting = (offer: string, qty: number) => ({
            posting_number: '321',
            status: 's',
            in_process_at: date.toISOString(),
            products: [{ price: '1.11', offer_id: offer, quantity: qty }],
            analytics_data: { warehouse_name: 'ПУШКИНО_1_РФЦ' },
            financial_data: { cluster_from: 'Москва, МО и Дальние регионы' },
        });

        it('(a) 1 prim, 1 шт — перенос подборки на строку счёта Б, резерв Б зачищен', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([cand(1001, 100, 100, 1, 'ПУШКИНО_1_РФЦ')]);

            await service.createInvoice(buildPosting('444', 1), null);

            expect(clearInvoiceReserve).toHaveBeenCalledWith(999, null);
            expect(migratePodbpos).toHaveBeenCalledWith(1001, 999, 300, '444', 1, null);
            expect(deltaGood).not.toHaveBeenCalled();
        });

        it('(b) 3 шт, 3 разных prim по 1 шт — 3 переноса', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([
                cand(1001, 100, 100, 1, 'ПУШКИНО_1_РФЦ'),
                cand(2002, 200, 200, 1, 'Москва, МО и Дальние регионы'),
                cand(3003, 300, 300, 1, 'отмена FBO 555'),
            ]);

            await service.createInvoice(buildPosting('444', 3), null);

            expect(migratePodbpos).toHaveBeenCalledTimes(3);
            expect(migratePodbpos.mock.calls.map((c) => c[0])).toEqual([1001, 2002, 3003]);
            expect(emit).not.toHaveBeenCalled();
        });

        it('(c) кандидат покрывает всё количество — один перенос на 3', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([cand(1001, 100, 100, 3, 'ПУШКИНО_1_РФЦ')]);

            await service.createInvoice(buildPosting('444', 3), null);

            expect(migratePodbpos).toHaveBeenCalledWith(1001, 999, 300, '444', 3, null);
            expect(deltaGood).not.toHaveBeenCalled();
        });

        it('(d) товар без КМ — только штуки, коды не трогаются', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([cand(1001, 100, 100, 2, 'ПУШКИНО_1_РФЦ')]);

            await service.createInvoice(buildPosting('444', 2), null);

            expect(migratePodbpos).toHaveBeenCalledWith(1001, 999, 300, '444', 2, null);
            expect(migrateMarkCode).not.toHaveBeenCalled();
            expect(deltaGood).not.toHaveBeenCalled();
        });

        it('(e) частичный fallback — need=3, candidates покрыли 2, deltaGood на 1 + письмо', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([cand(1001, 100, 100, 2, 'ПУШКИНО_1_РФЦ')]);
            await service.createInvoice(buildPosting('444', 3), null);

            expect(migratePodbpos).toHaveBeenCalledWith(1001, 999, 300, '444', 2, null);
            expect(deltaGood).toHaveBeenCalledTimes(1);
            expect(deltaGood.mock.calls[0]).toEqual(['444', 1, 'Москва, МО и Дальние регионы', null]);
            expect(emit).toHaveBeenCalledTimes(1);
            const [evt, subject, body] = emit.mock.calls[0];
            expect(evt).toBe('error.message');
            expect(subject).toBe('Ozon FBO: нет позиции — создана недостача');
            expect(body).toContain('Posting: 321');
            expect(body).toContain('GOODSCODE: 444, qty: 1');
            expect(body).toContain('warehouse_name: ПУШКИНО_1_РФЦ');
            expect(body).toContain('cluster_from:   Москва, МО и Дальние регионы');
        });

        it('(f) suffix-возврат — недостачи нет, письма нет', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([cand(9999, 900, 900, 1, '777-888 отмена FBO')]);
            await service.createInvoice(buildPosting('444', 1), null);

            expect(deltaGood).not.toHaveBeenCalled();
            expect(emit).not.toHaveBeenCalled();
        });

        it('(g) дубликаты goodCode в posting — каждый продукт едет на свою строку счёта Б', async () => {
            const posting = {
                posting_number: '321',
                status: 's',
                in_process_at: date.toISOString(),
                products: [
                    { price: '10', offer_id: '444', quantity: 1 },
                    { price: '20', offer_id: '444', quantity: 1 },
                ],
                analytics_data: { warehouse_name: 'ПУШКИНО_1_РФЦ' },
                financial_data: { cluster_from: 'Москва, МО и Дальние регионы' },
            };
            findFboPodbposCandidates
                .mockResolvedValueOnce([cand(1001, 100, 100, 1, 'ПУШКИНО_1_РФЦ')])
                .mockResolvedValueOnce([cand(2002, 200, 200, 1, 'ПУШКИНО_1_РФЦ')]);

            await service.createInvoice(posting, null);

            expect(migratePodbpos).toHaveBeenCalledTimes(2);
            expect(migratePodbpos.mock.calls[0]).toEqual([1001, 999, 300, '444', 1, null]);
            expect(migratePodbpos.mock.calls[1]).toEqual([2002, 999, 301, '444', 1, null]);
        });

        it('порядок: createInvoice → перенос подборки', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([cand(1001, 100, 100, 1, 'ПУШКИНО_1_РФЦ')]);

            await service.createInvoice(buildPosting('444', 1), null);

            const createOrder = createInvoiceFromPostingDto.mock.invocationCallOrder[0];
            const migrateOrder = migratePodbpos.mock.invocationCallOrder[0];
            expect(createOrder).toBeLessThan(migrateOrder);
        });
    });
});
