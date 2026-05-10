import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { IsRemarkValid } from '../validators/is.remark.valid';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MarkScanFbsService } from './mark-scan-fbs.service';
import { InvoiceDto } from './dto/invoice.dto';

describe('InvoiceController', () => {
    let controller: InvoiceController;
    const invoiceService = { update: jest.fn() };
    const markScan = {
        getProgress: jest.fn(),
        scan: jest.fn(),
        unscan: jest.fn(),
        isReadyToFinish: jest.fn(),
    };
    const invoice = { id: 100, remark: 'TEST' } as InvoiceDto;
    const remarkDto = { remark: 'TEST', invoice };

    beforeEach(async () => {
        Object.values(invoiceService).forEach((m: any) => m.mockReset?.());
        Object.values(markScan).forEach((m: any) => m.mockReset?.());
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: IsRemarkValid, useValue: {} },
                { provide: INVOICE_SERVICE, useValue: invoiceService },
                { provide: MarkScanFbsService, useValue: markScan },
            ],
            controllers: [InvoiceController],
        }).compile();
        controller = module.get(InvoiceController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('update — страховка FINISH_PICKUP', () => {
        it('без FINISH_PICKUP — обновление проходит, isReadyToFinish не вызывается', async () => {
            invoiceService.update.mockResolvedValueOnce(true);
            const r = await controller.update(remarkDto as any, { START_PICKUP: '2026-05-10 12:00:00' } as any);
            expect(r).toEqual({ isSuccess: true, invoice });
            expect(markScan.isReadyToFinish).not.toHaveBeenCalled();
        });

        it('с FINISH_PICKUP и ready=true — обновление проходит', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            const r = await controller.update(
                remarkDto as any,
                { FINISH_PICKUP: '2026-05-10 13:00:00', IGK: 'B1' } as any,
            );
            expect(r.isSuccess).toBe(true);
            expect(markScan.isReadyToFinish).toHaveBeenCalledWith(invoice);
        });

        it('с FINISH_PICKUP и ready=false → BadRequestException', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(false);
            await expect(
                controller.update(remarkDto as any, { FINISH_PICKUP: '2026-05-10 13:00:00' } as any),
            ).rejects.toThrow(BadRequestException);
            expect(invoiceService.update).not.toHaveBeenCalled();
        });
    });

    describe('markcode endpoints', () => {
        it('GET progress — проксирует в markScan.getProgress', async () => {
            const expected = { lines: [], isReadyToFinish: true, attachedKis: [] };
            markScan.getProgress.mockResolvedValueOnce(expected);
            await expect(controller.markcodeProgress(remarkDto as any)).resolves.toBe(expected);
            expect(markScan.getProgress).toHaveBeenCalledWith(invoice);
        });

        it('POST markcode — проксирует ki в markScan.scan', async () => {
            const expected = { attached: { ki: 'A', goodscode: '444', realpricecode: 1 }, progress: {} };
            markScan.scan.mockResolvedValueOnce(expected);
            await expect(controller.markcodeScan(remarkDto as any, { ki: 'A' })).resolves.toBe(expected);
            expect(markScan.scan).toHaveBeenCalledWith(invoice, 'A');
        });

        it('DELETE markcode — проксирует ki в markScan.unscan', async () => {
            const expected = { lines: [], isReadyToFinish: true, attachedKis: [] };
            markScan.unscan.mockResolvedValueOnce(expected);
            await expect(controller.markcodeUnscan(remarkDto as any, 'A')).resolves.toBe(expected);
            expect(markScan.unscan).toHaveBeenCalledWith(invoice, 'A');
        });
    });
});
