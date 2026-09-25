import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DonorTransferError, DonorTransferService } from './donor-transfer.service';

describe('DonorTransferService', () => {
    let service: DonorTransferService;
    const findLiveMigratableCodes = jest.fn();
    const migrateMarkCode = jest.fn();
    const migratePodbpos = jest.fn();
    const logMigrationLink = jest.fn();
    const getStorageSS = jest.fn();
    const emit = jest.fn();

    const donor = { podbposcode: 1001, scode: 100, realpricecode: 100 };
    const target = { scode: 500, realpricecode: 900, goodscode: '444', nominal: 5, posting: 'P-1' };

    beforeEach(async () => {
        [findLiveMigratableCodes, migrateMarkCode, migratePodbpos, logMigrationLink, getStorageSS, emit].forEach((m) => m.mockReset());
        getStorageSS.mockReturnValue(1);
        migrateMarkCode.mockResolvedValue(undefined);
        migratePodbpos.mockResolvedValue(undefined);
        findLiveMigratableCodes.mockResolvedValue([]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DonorTransferService,
                { provide: INVOICE_SERVICE, useValue: { findLiveMigratableCodes, migrateMarkCode, migratePodbpos, logMigrationLink, getStorageSS } },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get(DonorTransferService);
    });

    it('коды кратно номиналу, потом подборка, потом аудит', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }, { ki: 'KI-2' }, { ki: 'KI-3' }]);

        const res = await service.transfer(donor, 10, target, null);

        expect(res).toEqual({ moved: 10, codes: ['KI-1', 'KI-2'], stuck: 0 });
        expect(migrateMarkCode.mock.calls).toEqual([
            ['KI-1', 100, 900, '444', 1, null],
            ['KI-2', 100, 900, '444', 1, null],
        ]);
        expect(migratePodbpos).toHaveBeenCalledWith(1001, 500, 900, '444', 10, null);
        expect(logMigrationLink).toHaveBeenCalledWith(
            { posting: 'P-1', goodscode: '444', quantity: 10, donorScode: 100, donorRpc: 100, targetScode: 500, targetRpc: 900 },
            null,
        );
    });

    it('застрявший код: его штуки остаются на доноре, подборка едет на остаток', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }, { ki: 'KI-2' }]);
        migrateMarkCode.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('занят'));

        const res = await service.transfer(donor, 10, target, null);

        expect(res).toEqual({ moved: 5, codes: ['KI-1'], stuck: 1 });
        expect(migratePodbpos).toHaveBeenCalledWith(1001, 500, 900, '444', 5, null);
    });

    it('подборка не переехала → коды возвращены донору, наружу DonorTransferError', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }]);
        migratePodbpos.mockRejectedValueOnce(new Error('Подборка счёта-источника меньше переносимого количества'));

        await expect(service.transfer(donor, 5, target, null)).rejects.toBeInstanceOf(DonorTransferError);
        expect(migrateMarkCode.mock.calls).toEqual([
            ['KI-1', 100, 900, '444', 1, null],
            ['KI-1', 900, 100, '444', 1, null],
        ]);
        expect(logMigrationLink).not.toHaveBeenCalled();
    });

    it('все коды застряли → подборку не трогаем, moved = 0', async () => {
        findLiveMigratableCodes.mockResolvedValueOnce([{ ki: 'KI-1' }]);
        migrateMarkCode.mockRejectedValueOnce(new Error('занят'));

        const res = await service.transfer(donor, 5, target, null);

        expect(res).toEqual({ moved: 0, codes: [], stuck: 1 });
        expect(migratePodbpos).not.toHaveBeenCalled();
    });
});
