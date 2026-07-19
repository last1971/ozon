import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FboMarkMigrationService } from './fbo-mark-migration.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';

// S12: при FBO-переезде вместе с подборкой едут коды маркировки (TT=2/3),
// кратно номиналу, по кандидату строго «сначала коды, потом подборка».
describe('FboMarkMigrationService', () => {
    let service: FboMarkMigrationService;

    const findFboPodbposCandidates = jest.fn();
    const findLiveMigratableCodes = jest.fn();
    const migrateMarkCode = jest.fn();
    const migratePodbpos = jest.fn();
    const clearInvoiceReserve = jest.fn();
    const getStorageSS = jest.fn();
    const emit = jest.fn();

    const SCODE_B = 500;
    const line = (realpricecode: number, goodCode = '444', quantity = 15) => ({
        goodCode,
        quantity,
        price: '1',
        realpricecode,
    });

    beforeEach(async () => {
        [
            findFboPodbposCandidates,
            findLiveMigratableCodes,
            migrateMarkCode,
            migratePodbpos,
            clearInvoiceReserve,
            getStorageSS,
            emit,
        ].forEach((m) => m.mockReset());
        getStorageSS.mockReturnValue(1);
        migrateMarkCode.mockResolvedValue(undefined);
        migratePodbpos.mockResolvedValue(undefined);
        clearInvoiceReserve.mockResolvedValue(undefined);
        findLiveMigratableCodes.mockResolvedValue([]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FboMarkMigrationService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        findFboPodbposCandidates,
                        findLiveMigratableCodes,
                        migrateMarkCode,
                        migratePodbpos,
                        clearInvoiceReserve,
                        getStorageSS,
                    },
                },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();

        service = module.get<FboMarkMigrationService>(FboMarkMigrationService);
    });

    it('должен быть определён', () => {
        expect(service).toBeDefined();
    });

    it('полный переезд 3×5: коды перед подборкой, кратно номиналу, без shortages', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 15, prim: 'W', cntNom: 3, cntLive: 3, cntTt3: 1 },
        ]);
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-3' }, { ki: 'KI-1' }, { ki: 'KI-2' }]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444-5', quantity: 3 }],
            ['W'],
            [line(900)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([]);
        expect(clearInvoiceReserve).toHaveBeenCalledWith(SCODE_B, null);
        expect(findFboPodbposCandidates).toHaveBeenCalledWith('444', ['W'], 5, null);
        expect(findLiveMigratableCodes).toHaveBeenCalledWith(100, 5, null);
        expect(migrateMarkCode.mock.calls).toEqual([
            ['KI-3', 100, 900, '444', 1, null],
            ['KI-1', 100, 900, '444', 1, null],
            ['KI-2', 100, 900, '444', 1, null],
        ]);
        expect(migratePodbpos).toHaveBeenCalledWith(1001, SCODE_B, 900, '444', 15, null);
        // порядок: все коды до подборки
        const podbOrder = migratePodbpos.mock.invocationCallOrder[0];
        migrateMarkCode.mock.invocationCallOrder.forEach((o) => expect(o).toBeLessThan(podbOrder));
        expect(emit).not.toHaveBeenCalled();
    });

    it('кодов меньше, чем штук (часть без кодов): штуки едут, письмо, НЕ shortage', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 15, prim: 'W', cntNom: 1, cntLive: 1, cntTt3: 0 },
        ]);
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444-5', quantity: 3 }],
            ['W'],
            [line(900)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([]);
        expect(migrateMarkCode).toHaveBeenCalledTimes(1);
        expect(migratePodbpos).toHaveBeenCalledWith(1001, SCODE_B, 900, '444', 15, null);
        expect(emit).toHaveBeenCalledWith(
            'error.message',
            expect.stringContaining('без кодов'),
            expect.any(String),
        );
    });

    it('товар без кодов вообще (cntLive=0): только штуки, без письма', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 2, prim: 'W', cntNom: 0, cntLive: 0, cntTt3: 0 },
        ]);
        findLiveMigratableCodes.mockResolvedValueOnce([]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '777', quantity: 2 }],
            ['W'],
            [line(901, '777', 2)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([]);
        expect(migrateMarkCode).not.toHaveBeenCalled();
        expect(migratePodbpos).toHaveBeenCalledWith(1001, SCODE_B, 901, '777', 2, null);
        expect(emit).not.toHaveBeenCalled();
    });

    it('нет кандидатов → shortage на весь объём', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '777', quantity: 5 }],
            ['W'],
            [line(901, '777', 5)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([{ goodscode: '777', quantity: 5 }]);
        expect(migratePodbpos).not.toHaveBeenCalled();
    });

    it('некратная продажа (1 шт при кодах по 5): перенос падает → кандидат пропущен → shortage', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 15, prim: 'W', cntNom: 0, cntLive: 3, cntTt3: 0 },
        ]);
        findLiveMigratableCodes.mockResolvedValueOnce([]); // кодов номинала 1 нет
        migratePodbpos.mockRejectedValueOnce(new Error('нет столько свободно в приходе'));

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444', quantity: 1 }],
            ['W'],
            [line(902, '444', 1)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([{ goodscode: '444', quantity: 1 }]);
        expect(migrateMarkCode).not.toHaveBeenCalled();
    });

    it('перенос подборки упал после кодов → компенсация обратным переносом, кандидат пропущен', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 10, prim: 'A', cntNom: 2, cntLive: 2, cntTt3: 0 },
            { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 10, prim: 'B', cntNom: 2, cntLive: 2, cntTt3: 0 },
        ]);
        findLiveMigratableCodes
            .mockResolvedValueOnce([{ ki: 'KI-A1' }, { ki: 'KI-A2' }])
            .mockResolvedValueOnce([{ ki: 'KI-B1' }, { ki: 'KI-B2' }]);
        migratePodbpos
            .mockRejectedValueOnce(new Error('Подборка счёта-источника меньше переносимого количества'))
            .mockResolvedValueOnce(undefined);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444-5', quantity: 2 }],
            ['A', 'B'],
            [line(900, '444', 10)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([]);
        // компенсация: KI-A1/KI-A2 вернулись со строки Б на строку А
        expect(migrateMarkCode.mock.calls).toEqual([
            ['KI-A1', 100, 900, '444', 1, null],
            ['KI-A2', 100, 900, '444', 1, null],
            ['KI-A1', 900, 100, '444', 1, null],
            ['KI-A2', 900, 100, '444', 1, null],
            ['KI-B1', 200, 900, '444', 1, null],
            ['KI-B2', 200, 900, '444', 1, null],
        ]);
        expect(migratePodbpos.mock.calls).toEqual([
            [1001, SCODE_B, 900, '444', 10, null],
            [2002, SCODE_B, 900, '444', 10, null],
        ]);
    });

    it('застрявший код: его штуки остаются на А (take -= N), недобор → shortage', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 15, prim: 'W', cntNom: 3, cntLive: 3, cntTt3: 0 },
        ]);
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }, { ki: 'KI-2' }, { ki: 'KI-3' }]);
        migrateMarkCode
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('КМ уже перенесён/перепривязан другим процессом.'))
            .mockResolvedValueOnce(undefined);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444-5', quantity: 3 }],
            ['W'],
            [line(900)],
            SCODE_B,
            null,
        );

        // 2 кода уехали (10 шт), штуки застрявшего кода (5) остались на А
        expect(migratePodbpos).toHaveBeenCalledWith(1001, SCODE_B, 900, '444', 10, null);
        expect(shortages).toEqual([{ goodscode: '444', quantity: 5 }]);
    });

    it('нет realpricecode для строки → исключение (ошибка маппинга, транзакция должна откатиться)', async () => {
        await expect(
            service.migrate(
                [{ price: '1', offer_id: '444', quantity: 1 }],
                ['W'],
                [{ goodCode: '444', quantity: 1, price: '1' }],
                SCODE_B,
                null,
            ),
        ).rejects.toThrow('нет realpricecode');
        expect(findFboPodbposCandidates).not.toHaveBeenCalled();
    });

    it('2 товара → независимые выборки кандидатов и строки Б по индексу', async () => {
        findFboPodbposCandidates
            .mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'P', cntNom: 0, cntLive: 0, cntTt3: 0 },
            ])
            .mockResolvedValueOnce([
                { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 1, prim: 'P', cntNom: 0, cntLive: 0, cntTt3: 0 },
            ]);

        const shortages = await service.migrate(
            [
                { price: '1', offer_id: '111', quantity: 1 },
                { price: '2', offer_id: '222', quantity: 1 },
            ],
            ['P'],
            [line(901, '111', 1), line(902, '222', 1)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([]);
        expect(findFboPodbposCandidates.mock.calls[0]).toEqual(['111', ['P'], 1, null]);
        expect(findFboPodbposCandidates.mock.calls[1]).toEqual(['222', ['P'], 1, null]);
        expect(migratePodbpos.mock.calls[0]).toEqual([1001, SCODE_B, 901, '111', 1, null]);
        expect(migratePodbpos.mock.calls[1]).toEqual([2002, SCODE_B, 902, '222', 1, null]);
    });

    it('quanAvail > need → take = need, не лишнего', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 10, prim: 'P', cntNom: 0, cntLive: 0, cntTt3: 0 },
        ]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '999', quantity: 2 }],
            ['P'],
            [line(903, '999', 2)],
            SCODE_B,
            null,
        );

        expect(shortages).toEqual([]);
        expect(migratePodbpos).toHaveBeenCalledWith(1001, SCODE_B, 903, '999', 2, null);
    });
});
