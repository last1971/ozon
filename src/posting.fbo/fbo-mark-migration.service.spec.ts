import { Test, TestingModule } from '@nestjs/testing';
import { FboMarkMigrationService } from './fbo-mark-migration.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';

// Количественные коды (2026-07): при FBO-переезде КМ НЕ трогаем — они уже ушли
// в УПД-2 (TT=2, retired). Переезжает только количество в подборке (PODBPOS).
describe('FboMarkMigrationService', () => {
    let service: FboMarkMigrationService;

    const findFboPodbposCandidates = jest.fn();
    const decrementPodbpos = jest.fn();
    const getStorageSS = jest.fn();

    beforeEach(async () => {
        [findFboPodbposCandidates, decrementPodbpos, getStorageSS].forEach((m) => m.mockReset());
        getStorageSS.mockReturnValue(1);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FboMarkMigrationService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        findFboPodbposCandidates,
                        decrementPodbpos,
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

    it('(a) 1 товар, 1 кандидат покрывает полностью → shortages пуст, только decrementPodbpos', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 2, prim: 'WBFBO' },
        ]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '444', quantity: 2 }],
            ['WBFBO'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(decrementPodbpos).toHaveBeenCalledTimes(1);
        expect(decrementPodbpos).toHaveBeenCalledWith(1001, 2, null);
    });

    it('(b) 1 товар, 2 кандидата (первый частично, второй добивает)', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'A' },
            { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 2, prim: 'B' },
        ]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '555', quantity: 3 }],
            ['A', 'B'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(decrementPodbpos).toHaveBeenCalledTimes(2);
        expect(decrementPodbpos.mock.calls[0]).toEqual([1001, 1, null]);
        expect(decrementPodbpos.mock.calls[1]).toEqual([2002, 2, null]);
    });

    it('(c) 1 товар, нет кандидатов → shortages=[gc,need]', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '777', quantity: 5 }],
            ['WBFBO'],
            null,
        );

        expect(shortages).toEqual([{ goodscode: '777', quantity: 5 }]);
        expect(decrementPodbpos).not.toHaveBeenCalled();
    });

    it('(d) 2 товара (разные gc) → независимые candidates запросы', async () => {
        findFboPodbposCandidates
            .mockResolvedValueOnce([
                { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'P' },
            ])
            .mockResolvedValueOnce([
                { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 1, prim: 'P' },
            ]);

        const shortages = await service.migrate(
            [
                { price: '1', offer_id: '111', quantity: 1 },
                { price: '2', offer_id: '222', quantity: 1 },
            ],
            ['P'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(findFboPodbposCandidates.mock.calls[0]).toEqual(['111', ['P'], null]);
        expect(findFboPodbposCandidates.mock.calls[1]).toEqual(['222', ['P'], null]);
        expect(decrementPodbpos.mock.calls[0]).toEqual([1001, 1, null]);
        expect(decrementPodbpos.mock.calls[1]).toEqual([2002, 1, null]);
    });

    it('(e) candidate.quanAvail > need → take = need (не лишнего)', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 10, prim: 'P' },
        ]);

        const shortages = await service.migrate(
            [{ price: '1', offer_id: '999', quantity: 2 }],
            ['P'],
            null,
        );

        expect(shortages).toEqual([]);
        expect(decrementPodbpos).toHaveBeenCalledWith(1001, 2, null);
    });

    // Defensive regression test: цикл миграции работает внутри Firebird-транзакции.
    // Если decrementPodbpos бросит exception в середине цикла, исключение ДОЛЖНО
    // пробрасываться наверх (а не быть проглочено try/catch внутри migrate) — иначе
    // вызывающий код не сделает rollback. Тест защищает от случайного добавления
    // try/catch вокруг тела цикла в будущем.
    it('error propagation: если decrementPodbpos падает на 2-м кандидате → исключение пробрасывается', async () => {
        findFboPodbposCandidates.mockResolvedValueOnce([
            { podbposcode: 1001, scode: 100, realpricecode: 100, quanAvail: 1, prim: 'A' },
            { podbposcode: 2002, scode: 200, realpricecode: 200, quanAvail: 1, prim: 'B' },
            { podbposcode: 3003, scode: 300, realpricecode: 300, quanAvail: 1, prim: 'C' },
        ]);
        decrementPodbpos
            .mockResolvedValueOnce(undefined) // 1-й candidate OK
            .mockRejectedValueOnce(new Error('DB connection lost')); // 2-й падает

        await expect(
            service.migrate([{ price: '1', offer_id: '444', quantity: 3 }], ['P'], null),
        ).rejects.toThrow('DB connection lost');

        // 3-го кандидата касаться не должны (цикл прерван).
        expect(decrementPodbpos).toHaveBeenCalledTimes(2);
    });
});
