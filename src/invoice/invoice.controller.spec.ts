import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceController } from './invoice.controller';
import { IsRemarkValid } from '../validators/is.remark.valid';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MarkScanFbsService } from './mark-scan-fbs.service';
import { InvoiceDto } from './dto/invoice.dto';

describe('InvoiceController', () => {
    let controller: InvoiceController;
    const invoiceService = { update: jest.fn(), distributePaymentByUPD: jest.fn() };
    const markScan = {
        getProgress: jest.fn(),
        scan: jest.fn(),
        unscan: jest.fn(),
        isReadyToFinish: jest.fn(),
    };
    const invoice = { id: 100, remark: 'TEST', buyerId: 7 } as InvoiceDto;
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
