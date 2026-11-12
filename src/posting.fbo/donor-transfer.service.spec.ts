import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DonorTransferError, DonorTransferService } from './donor-transfer.service';
import { FirebirdTransaction } from 'ts-firebird';

describe('DonorTransferService', () => {
    let service: DonorTransferService;
    const findLiveMigratableCodes = jest.fn();
    const migrateMarkCode = jest.fn();
    const migratePodbpos = jest.fn();
    const logMigrationLink = jest.fn();
    const getStorageSS = jest.fn();
    const emit = jest.fn();
    const execute = jest.fn();
    const t = { execute } as unknown as FirebirdTransaction;

    const donor = { podbposcode: 1001, scode: 100, realpricecode: 100 };
    const target = { scode: 500, realpricecode: 900, goodscode: '444', nominal: 5, posting: 'P-1' };

    beforeEach(async () => {
        [
            findLiveMigratableCodes,
            migrateMarkCode,
            migratePodbpos,
            logMigrationLink,
            getStorageSS,
            emit,
            execute,
        ].forEach((m) => m.mockReset());
        getStorageSS.mockReturnValue(1);
        execute.mockResolvedValue(undefined);
        migrateMarkCode.mockResolvedValue(undefined);
        migratePodbpos.mockResolvedValue(undefined);
        findLiveMigratableCodes.mockResolvedValue([]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DonorTransferService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        findLiveMigratableCodes,
                        migrateMarkCode,
                        migratePodbpos,
                        logMigrationLink,
                        getStorageSS,
                    },
                },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get(DonorTransferService);
    });

    it('коды кратно номиналу, потом подборка, потом аудит', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }, { ki: 'KI-2' }, { ki: 'KI-3' }]);

        const res = await service.transfer(donor, 10, target, t);

        expect(res).toEqual({ moved: 10, codes: ['KI-1', 'KI-2'], stuck: 0 });
        expect(migrateMarkCode.mock.calls).toEqual([
            ['KI-1', 100, 900, '444', 1, t],
            ['KI-2', 100, 900, '444', 1, t],
        ]);
        expect(migratePodbpos).toHaveBeenCalledWith(1001, 500, 900, '444', 10, t);
        expect(logMigrationLink).toHaveBeenCalledWith(
            {
                posting: 'P-1',
                goodscode: '444',
                quantity: 10,
                donorScode: 100,
                donorRpc: 100,
                targetScode: 500,
                targetRpc: 900,
            },
            t,
        );
    });

    it('застрявший код: его штуки остаются на доноре, подборка едет на остаток', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }, { ki: 'KI-2' }]);
        migrateMarkCode.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('занят'));

        const res = await service.transfer(donor, 10, target, t);

        expect(res).toEqual({ moved: 5, codes: ['KI-1'], stuck: 1 });
        expect(migratePodbpos).toHaveBeenCalledWith(1001, 500, 900, '444', 5, t);
    });

    it('подборка не переехала → откат кодов и подбора до savepoint', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }]);
        migratePodbpos.mockRejectedValueOnce(new Error('Подборка счёта-источника меньше переносимого количества'));

        await expect(service.transfer(donor, 5, target, t)).rejects.toBeInstanceOf(DonorTransferError);
        expect(migrateMarkCode.mock.calls).toEqual([['KI-1', 100, 900, '444', 1, t]]);
        expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
            'SAVEPOINT FBO_DONOR_TRANSFER',
            'ROLLBACK TO SAVEPOINT FBO_DONOR_TRANSFER',
            'RELEASE SAVEPOINT FBO_DONOR_TRANSFER',
        ]);
        expect(logMigrationLink).not.toHaveBeenCalled();
    });

    it('аудит не записался → весь перенос кандидата откатывается', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }]);
        logMigrationLink.mockRejectedValueOnce(new Error('Аудит недоступен'));
        await expect(service.transfer(donor, 5, target, t)).rejects.toThrow('Аудит недоступен');
        expect(execute).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT FBO_DONOR_TRANSFER', [], false);
    });

    it('не удалось откатить savepoint → фатальная ошибка, кандидата нельзя молча пропустить', async () => {
        migratePodbpos.mockRejectedValueOnce(new Error('Марки остаются на доноре'));
        execute.mockImplementation(async (sql) => {
            if (sql.startsWith('ROLLBACK')) throw new Error('Транзакция потеряна');
        });
        await expect(service.transfer(donor, 5, target, t)).rejects.toThrow('Транзакция потеряна');
        expect(logMigrationLink).not.toHaveBeenCalled();
    });

    it('успешный перенос освобождает savepoint и не коммитит общую транзакцию', async () => {
        await service.transfer(donor, 5, target, t);
        expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
            'SAVEPOINT FBO_DONOR_TRANSFER',
            'RELEASE SAVEPOINT FBO_DONOR_TRANSFER',
        ]);
    });

    it('без общей транзакции перенос не начинается', async () => {
        await expect(service.transfer(donor, 5, target, null)).rejects.toThrow('общей транзакции');
        expect(migrateMarkCode).not.toHaveBeenCalled();
        expect(migratePodbpos).not.toHaveBeenCalled();
    });

    it('все коды застряли → подборку не трогаем, moved = 0', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }]);
        migrateMarkCode.mockRejectedValueOnce(new Error('занят'));

        const res = await service.transfer(donor, 5, target, t);

        expect(res).toEqual({ moved: 0, codes: [], stuck: 1 });
        expect(migratePodbpos).not.toHaveBeenCalled();
    });
});
