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
    const getAttachedMarkCodesForMigration = jest.fn();
    const decrementPodbpos = jest.fn();
    const detachMarkCode = jest.fn();
    const reattachMarkCodeTransferred = jest.fn();
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
            getAttachedMarkCodesForMigration,
            decrementPodbpos,
            detachMarkCode,
            reattachMarkCodeTransferred,
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
                        getAttachedMarkCodesForMigration,
                        decrementPodbpos,
                        detachMarkCode,
                        reattachMarkCodeTransferred,
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
        beforeEach(() => {
            migrationEnabled = true;
            createInvoiceFromPostingDto.mockResolvedValue({ id: 999 });
            findRealpriceCodes.mockResolvedValue([300]);
        });

        const buildPosting = (offer: string, qty: number) => ({
            posting_number: '321',
            status: 's',
            in_process_at: date.toISOString(),
            products: [{ price: '1.11', offer_id: offer, quantity: qty }],
            analytics_data: { warehouse_name: 'ПУШКИНО_1_РФЦ' },
            financial_data: { cluster_from: 'Москва, МО и Дальние регионы' },
        });

        it('(a) 1 prim, 1 шт, 1 КМ — REATTACH вызван 1 раз, decrement 1 раз', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'ПУШКИНО_1_РФЦ' },
            ]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'A' }]);

            await service.createInvoice(buildPosting('444', 1), null);

            expect(detachMarkCode).toHaveBeenCalledTimes(1);
            expect(detachMarkCode.mock.calls[0]).toEqual(['A', 100, 1, null]);
            expect(reattachMarkCodeTransferred).toHaveBeenCalledTimes(1);
            expect(reattachMarkCodeTransferred.mock.calls[0]).toEqual(['A', 300, '444', 1, null]);
            expect(decrementPodbpos).toHaveBeenCalledWith(1001, 1, null);
            expect(deltaGood).not.toHaveBeenCalled();
        });

        it('(b) 3 шт, 3 разных prim по 1 шт — 3 REATTACH, 3 decrement', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'ПУШКИНО_1_РФЦ' },
                { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 1, prim: 'Москва, МО и Дальние регионы' },
                { podbposcode: 3003, scode: 300, realpricecode: 300, quanAvail: 1, prim: 'отмена FBO 555' },
            ]);
            getAttachedMarkCodesForMigration
                .mockResolvedValueOnce([{ ki: 'A' }])
                .mockResolvedValueOnce([{ ki: 'B' }])
                .mockResolvedValueOnce([{ ki: 'C' }]);

            await service.createInvoice(buildPosting('444', 3), null);

            expect(detachMarkCode).toHaveBeenCalledTimes(3);
            expect(reattachMarkCodeTransferred).toHaveBeenCalledTimes(3);
            expect(decrementPodbpos).toHaveBeenCalledTimes(3);
            expect(decrementPodbpos.mock.calls.map((c) => c[0])).toEqual([1001, 2002, 3003]);
            expect(emit).not.toHaveBeenCalled();
        });

        it('(c) 2 марк + 1 не-марк в одной выборке — REATTACH 2, decrement общий = 3', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 3, prim: 'ПУШКИНО_1_РФЦ' },
            ]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'A' }, { ki: 'B' }]);

            await service.createInvoice(buildPosting('444', 3), null);

            expect(detachMarkCode).toHaveBeenCalledTimes(2);
            expect(reattachMarkCodeTransferred).toHaveBeenCalledTimes(2);
            expect(decrementPodbpos).toHaveBeenCalledWith(1001, 3, null);
            expect(deltaGood).not.toHaveBeenCalled();
        });

        it('(d) товар без КМ — миграция skip, только decrement', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 2, prim: 'ПУШКИНО_1_РФЦ' },
            ]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([]);

            await service.createInvoice(buildPosting('444', 2), null);

            expect(detachMarkCode).not.toHaveBeenCalled();
            expect(reattachMarkCodeTransferred).not.toHaveBeenCalled();
            expect(decrementPodbpos).toHaveBeenCalledWith(1001, 2, null);
            expect(deltaGood).not.toHaveBeenCalled();
        });

        it('(e) частичный fallback — need=3, candidates покрыли 2, deltaGood на 1 + письмо', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 2, prim: 'ПУШКИНО_1_РФЦ' },
            ]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([]);

            await service.createInvoice(buildPosting('444', 3), null);

            expect(decrementPodbpos).toHaveBeenCalledWith(1001, 2, null);
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
            findFboPodbposCandidates.mockResolvedValueOnce([
                { podbposcode: 9999, scode: 900, realpricecode: 900, quanAvail: 1, prim: '777-888 отмена FBO' },
            ]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([]);

            await service.createInvoice(buildPosting('444', 1), null);

            expect(deltaGood).not.toHaveBeenCalled();
            expect(emit).not.toHaveBeenCalled();
        });

        it('(g) дубликаты goodCode в posting — RPC берётся по индексу, а не по goodscode', async () => {
            // Два product с одинаковым goodCode '444' (offer_id 'AAA-1' и 'AAA-2' оба → '444' если бы было goodCode таким; здесь имитируем prepared input)
            // Здесь оба offer_id = '444', чтобы goodCode() оба раза вернул '444'
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
            findRealpriceCodes.mockResolvedValueOnce([301, 302]); // RPC для 1-й и 2-й строки
            findFboPodbposCandidates
                .mockResolvedValueOnce([{ podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'ПУШКИНО_1_РФЦ' }])
                .mockResolvedValueOnce([{ podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 1, prim: 'ПУШКИНО_1_РФЦ' }]);
            getAttachedMarkCodesForMigration
                .mockResolvedValueOnce([{ ki: 'A' }])
                .mockResolvedValueOnce([{ ki: 'B' }]);

            await service.createInvoice(posting, null);

            expect(detachMarkCode).toHaveBeenCalledTimes(2);
            expect(reattachMarkCodeTransferred).toHaveBeenCalledTimes(2);
            // 1-й продукт → reattach в newRpc=301
            expect(reattachMarkCodeTransferred.mock.calls[0]).toEqual(['A', 301, '444', 1, null]);
            // 2-й продукт → reattach в newRpc=302 (НЕ 301)
            expect(reattachMarkCodeTransferred.mock.calls[1]).toEqual(['B', 302, '444', 1, null]);
        });

        it('порядок: DETACH → decrementPodbpos → REATTACH (для каждого candidate)', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'ПУШКИНО_1_РФЦ' },
            ]);
            getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'A' }]);

            await service.createInvoice(buildPosting('444', 1), null);

            const createOrder = createInvoiceFromPostingDto.mock.invocationCallOrder[0];
            const detachOrder = detachMarkCode.mock.invocationCallOrder[0];
            const decOrder = decrementPodbpos.mock.invocationCallOrder[0];
            const reattachOrder = reattachMarkCodeTransferred.mock.invocationCallOrder[0];
            expect(createOrder).toBeLessThan(detachOrder);
            expect(detachOrder).toBeLessThan(decOrder);
            expect(decOrder).toBeLessThan(reattachOrder);
        });
    });
});
