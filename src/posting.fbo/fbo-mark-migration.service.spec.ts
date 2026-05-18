import { Test, TestingModule } from '@nestjs/testing';
import { FboMarkMigrationService } from './fbo-mark-migration.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';

describe('FboMarkMigrationService', () => {
    let service: FboMarkMigrationService;

    const findFboPodbposCandidates = jest.fn();
    const getAttachedMarkCodesForMigration = jest.fn();
    const detachMarkCode = jest.fn();
    const decrementPodbpos = jest.fn();
    const reattachMarkCodeTransferred = jest.fn();
    const getStorageSS = jest.fn();

    beforeEach(async () => {
        [
            findFboPodbposCandidates,
            getAttachedMarkCodesForMigration,
            detachMarkCode,
            decrementPodbpos,
            reattachMarkCodeTransferred,
            getStorageSS,
        ].forEach((m) => m.mockReset());
        getStorageSS.mockReturnValue(1);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FboMarkMigrationService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        findFboPodbposCandidates,
                        getAttachedMarkCodesForMigration,
                        detachMarkCode,
                        decrementPodbpos,
                        reattachMarkCodeTransferred,
                        getStorageSS,
                    },
                },
            ],
        }).compile();

        service = module.get<FboMarkMigrationService>(FboMarkMigrationService);
    });

    it('должен быть определён', () => {
        expect(service).toBeDefined();
    });

    it('(a) 1 товар, 1 кандидат, КМ покрывает полностью → shortages пуст', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 2, prim: 'WBFBO' },
        ]);
        getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'A' }, { ki: 'B' }]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444', quantity: 2 }],
            [300],
            ['WBFBO'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(detachMarkCode).toHaveBeenCalledTimes(2);
        expect(detachMarkCode.mock.calls[0]).toEqual(['A', 100, 1, null]);
        expect(detachMarkCode.mock.calls[1]).toEqual(['B', 100, 1, null]);
        expect(decrementPodbpos).toHaveBeenCalledWith(1001, 2, null);
        expect(reattachMarkCodeTransferred).toHaveBeenCalledTimes(2);
        expect(reattachMarkCodeTransferred.mock.calls[0]).toEqual(['A', 300, '444', 1, null]);
        expect(reattachMarkCodeTransferred.mock.calls[1]).toEqual(['B', 300, '444', 1, null]);
    });

    it('(b) 1 товар, 2 кандидата (первый частично, второй добивает)', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'A' },
            { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 2, prim: 'B' },
        ]);
        getAttachedMarkCodesForMigration
            .mockResolvedValueOnce([{ ki: 'X' }])
            .mockResolvedValueOnce([{ ki: 'Y' }, { ki: 'Z' }]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '555', quantity: 3 }],
            [301],
            ['A', 'B'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(decrementPodbpos).toHaveBeenCalledTimes(2);
        expect(decrementPodbpos.mock.calls[0]).toEqual([1001, 1, null]);
        expect(decrementPodbpos.mock.calls[1]).toEqual([2002, 2, null]);
        expect(reattachMarkCodeTransferred).toHaveBeenCalledTimes(3);
        expect(getAttachedMarkCodesForMigration.mock.calls[0]).toEqual([100, '555', 1, null]);
        expect(getAttachedMarkCodesForMigration.mock.calls[1]).toEqual([200, '555', 2, null]);
    });

    it('(c) 1 товар, нет кандидатов → shortages=[gc,need]', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '777', quantity: 5 }],
            [400],
            ['WBFBO'],
            null,
        );

        expect(shortages).toEqual([{ goodscode: '777', quantity: 5 }]);
        expect(detachMarkCode).not.toHaveBeenCalled();
        expect(decrementPodbpos).not.toHaveBeenCalled();
        expect(reattachMarkCodeTransferred).not.toHaveBeenCalled();
    });

    it('(d) 2 товара (разные gc) → независимые newRpcs[i] и независимые candidates запросы', async () => {
        findFboPodbposCandidates
            .mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'P' },
            ])
            .mockResolvedValueOnce([
                { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 1, prim: 'P' },
            ]);
        getAttachedMarkCodesForMigration
            .mockResolvedValueOnce([{ ki: 'A' }])
            .mockResolvedValueOnce([{ ki: 'B' }]);

        const shortages = await service.migrate(
            [
                { price: '1', offer_id: '111', quantity: 1 },
                { price: '2', offer_id: '222', quantity: 1 },
            ],
            [301, 302],
            ['P'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(findFboPodbposCandidates.mock.calls[0]).toEqual(['111', ['P'], null]);
        expect(findFboPodbposCandidates.mock.calls[1]).toEqual(['222', ['P'], null]);
        expect(reattachMarkCodeTransferred.mock.calls[0]).toEqual(['A', 301, '111', 1, null]);
        expect(reattachMarkCodeTransferred.mock.calls[1]).toEqual(['B', 302, '222', 1, null]);
    });

    it('(e) candidate.quanAvail > need → take = need (не лишнего)', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 10, prim: 'P' },
        ]);
        getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'A' }, { ki: 'B' }]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '999', quantity: 2 }],
            [500],
            ['P'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(decrementPodbpos).toHaveBeenCalledWith(1001, 2, null);
        expect(getAttachedMarkCodesForMigration).toHaveBeenCalledWith(100, '999', 2, null);
    });

    it('(f) товар без КМ (codes пуст) → decrement выполняется, REATTACH не вызывается', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 3, prim: 'P' },
        ]);
        getAttachedMarkCodesForMigration.mockResolvedValueOnce([]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444', quantity: 3 }],
            [300],
            ['P'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(detachMarkCode).not.toHaveBeenCalled();
        expect(reattachMarkCodeTransferred).not.toHaveBeenCalled();
        expect(decrementPodbpos).toHaveBeenCalledWith(1001, 3, null);
    });

    // Defensive regression test: цикл миграции работает внутри Firebird-транзакции.
    // Если какой-то из методов IInvoice бросит exception в середине цикла, исключение ДОЛЖНО
    // пробрасываться наверх (а не быть проглочено try/catch внутри migrate) — иначе вызывающий
    // код не сделает rollback и КМ останутся в полу-перенесённом состоянии.
    // Тест защищает от случайного добавления try/catch вокруг тела цикла в будущем.
    it('error propagation: если decrementPodbpos падает на 2-м кандидате → исключение пробрасывается', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'A' },
            { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 1, prim: 'B' },
            { podbposcode: 3003, scode: 300, realpricecode: 300, quanAvail: 1, prim: 'C' },
        ]);
        getAttachedMarkCodesForMigration
            .mockResolvedValueOnce([{ ki: 'A' }])
            .mockResolvedValueOnce([{ ki: 'B' }]);
        decrementPodbpos
            .mockResolvedValueOnce(undefined) // 1-й candidate OK
            .mockRejectedValueOnce(new Error('DB connection lost')); // 2-й падает

        await expect(
            service.migrate(
                [{ price: '1', offer_id: '444', quantity: 3 }],
                [300],
                ['P'],
                null,
            ),
        ).rejects.toThrow('DB connection lost');

        // На момент падения должны успеть выполниться: 1-й кандидат полностью + DETACH 2-го,
        // но 3-го кандидата касаться не должны (цикл прерван).
        expect(detachMarkCode).toHaveBeenCalledTimes(2);
        expect(decrementPodbpos).toHaveBeenCalledTimes(2);
        expect(reattachMarkCodeTransferred).toHaveBeenCalledTimes(1); // только 1-й candidate успел
    });

    it('порядок: DETACH → decrementPodbpos → REATTACH (для каждого candidate)', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'P' },
        ]);
        getAttachedMarkCodesForMigration.mockResolvedValueOnce([{ ki: 'A' }]);

        await service.migrate(
            [{ price: '1', offer_id: '444', quantity: 1 }],
            [300],
            ['P'],
            null,
        );

        const detachOrder = detachMarkCode.mock.invocationCallOrder[0];
        const decOrder = decrementPodbpos.mock.invocationCallOrder[0];
        const reattachOrder = reattachMarkCodeTransferred.mock.invocationCallOrder[0];
        expect(detachOrder).toBeLessThan(decOrder);
        expect(decOrder).toBeLessThan(reattachOrder);
    });
});
