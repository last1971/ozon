import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DonorApplyService } from './donor-apply.service';
import { DonorTransferError, DonorTransferService } from './donor-transfer.service';

describe('DonorApplyService', () => {
    let service: DonorApplyService;
    const commit = jest.fn();
    const rollback = jest.fn();
    const t = { commit, rollback };
    const getTransaction = jest.fn().mockResolvedValue(t);
    const findDonorsByPrim = jest.fn();
    const clearInvoiceReserve = jest.fn();
    const closeFboShortage = jest.fn();
    const isInFboShortage = jest.fn();
    const getPrimContaining = jest.fn();
    const pickupFboUnlessShortage = jest.fn();
    const transfer = jest.fn();
    const emit = jest.fn();

    const donor = { invoiceNumber: 10, scode: 100, date: null, prim: null, podbposcode: 1, realpricecode: 101, quantity: 6, canTake: true };
    const offer = () => [{
        invoiceNumber: 1, scode: 500, status: 1, date: null, prim: 'P-1', buyerCode: 7, inShortage: true,
        lines: [{ realpricecode: 900, goodscode: '444', name: 'Реле', quantity: 6, pieces: 1, picked: 0, shortage: 6, inShortage: true, donors: [donor] }],
    }];

    beforeEach(async () => {
        [commit, rollback, findDonorsByPrim, clearInvoiceReserve, closeFboShortage, isInFboShortage, getPrimContaining, pickupFboUnlessShortage, transfer, emit].forEach((m) => m.mockReset());
        getTransaction.mockResolvedValue(t);
        findDonorsByPrim.mockResolvedValue(offer());
        isInFboShortage.mockResolvedValue(false);
        getPrimContaining.mockResolvedValue([{ id: 500, remark: 'P-1' }]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DonorApplyService,
                { provide: INVOICE_SERVICE, useValue: { getTransaction, findDonorsByPrim, clearInvoiceReserve, closeFboShortage, isInFboShortage, getPrimContaining, pickupFboUnlessShortage } },
                { provide: DonorTransferService, useValue: { transfer } },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get(DonorApplyService);
    });

    it('выбор проходит: резерв снят, перенос той же точкой, журнал закрыт, счёт в подбор, commit', async () => {
        transfer.mockResolvedValue({ moved: 6, codes: ['KI-1'], stuck: 0 });

        const res = await service.apply('P-1', { scode: 500, picks: [{ realpricecode: 900, podbposcode: 1, quantity: 6 }] });

        expect(clearInvoiceReserve).toHaveBeenCalledWith(500, t);
        expect(transfer).toHaveBeenCalledWith(
            { podbposcode: 1, scode: 100, realpricecode: 101, invoiceNumber: 10 },
            6,
            { scode: 500, realpricecode: 900, goodscode: '444', nominal: 1, posting: 'P-1' },
            t,
        );
        expect(closeFboShortage).toHaveBeenCalledWith('P-1', '444', 6, t);
        expect(pickupFboUnlessShortage).toHaveBeenCalledWith({ id: 500, remark: 'P-1' }, t);
        expect(commit).toHaveBeenCalled();
        expect(res).toEqual({
            posting: 'P-1', scode: 500, shortageClosed: true, pickedUp: true,
            moved: [{ realpricecode: 900, goodscode: '444', donorInvoiceNumber: 10, quantity: 6, codes: ['KI-1'] }],
        });
        expect(emit).toHaveBeenCalled();
    });

    it('неверный выбор → 400 с текстом, ничего не переносится, rollback', async () => {
        await expect(service.apply('P-1', { scode: 500, picks: [{ realpricecode: 900, podbposcode: 1, quantity: 4 }] })).rejects.toBeInstanceOf(BadRequestException);
        expect(transfer).not.toHaveBeenCalled();
        expect(rollback).toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
    });

    it('перенос упал → всё или ничего: rollback, 400', async () => {
        transfer.mockRejectedValue(new DonorTransferError('меньше переносимого', { podbposcode: 1, scode: 100, realpricecode: 101 }, []));

        await expect(service.apply('P-1', { scode: 500, picks: [{ realpricecode: 900, podbposcode: 1, quantity: 6 }] })).rejects.toThrow('перенос не прошёл');
        expect(closeFboShortage).not.toHaveBeenCalled();
        expect(rollback).toHaveBeenCalled();
    });

    it('застрявший код уменьшил перенос → откат, повторить выбор', async () => {
        transfer.mockResolvedValue({ moved: 5, codes: [], stuck: 1 });

        await expect(service.apply('P-1', { scode: 500, picks: [{ realpricecode: 900, podbposcode: 1, quantity: 6 }] })).rejects.toThrow('переехало 5 из 6');
        expect(rollback).toHaveBeenCalled();
    });
});
