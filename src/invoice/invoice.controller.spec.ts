import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceController } from './invoice.controller';
import { IsRemarkValid } from '../validators/is.remark.valid';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MarkScanFbsService } from './mark-scan-fbs.service';
import { InvoiceDto } from './dto/invoice.dto';
import { OrderService } from '../order/order.service';

describe('InvoiceController', () => {
    let controller: InvoiceController;
    const invoiceService = { update: jest.fn() };
    const markScan = {
        getProgress: jest.fn(),
        scan: jest.fn(),
        unscan: jest.fn(),
        isReadyToFinish: jest.fn(),
    };
    const submitFbsMarkCodes = jest.fn();
    const orderService = { getServiceByBuyerId: jest.fn() };
    let markEnabled = true;
    const configService = {
        get: jest.fn((key: string, def?: any) => (key === 'MARK_CODES_ENABLED' ? markEnabled : def)),
    };
    const invoice = { id: 100, remark: 'TEST', buyerId: 7 } as InvoiceDto;
    const remarkDto = { remark: 'TEST', invoice };

    beforeEach(async () => {
        Object.values(invoiceService).forEach((m: any) => m.mockReset?.());
        Object.values(markScan).forEach((m: any) => m.mockReset?.());
        orderService.getServiceByBuyerId.mockReset();
        submitFbsMarkCodes.mockReset();
        configService.get.mockClear();
        markEnabled = true;
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: IsRemarkValid, useValue: {} },
                { provide: INVOICE_SERVICE, useValue: invoiceService },
                { provide: MarkScanFbsService, useValue: markScan },
                { provide: OrderService, useValue: orderService },
                { provide: ConfigService, useValue: configService },
            ],
            controllers: [InvoiceController],
        }).compile();
        controller = module.get(InvoiceController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('update — страховка FINISH_PICKUP', () => {
        it('без FINISH_PICKUP — обновление проходит, isReadyToFinish/submit не вызываются', async () => {
            invoiceService.update.mockResolvedValueOnce(true);
            const r = await controller.update(remarkDto as any, { START_PICKUP: '2026-05-10 12:00:00' } as any);
            expect(r).toEqual({ isSuccess: true, invoice, submit: undefined });
            expect(markScan.isReadyToFinish).not.toHaveBeenCalled();
            expect(orderService.getServiceByBuyerId).not.toHaveBeenCalled();
        });

        it('с FINISH_PICKUP и ready=true — обновление проходит', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            orderService.getServiceByBuyerId.mockReturnValueOnce(null);
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
            expect(orderService.getServiceByBuyerId).not.toHaveBeenCalled();
        });
    });

    describe('update — submitFbsMarkCodes', () => {
        const finishDto = { FINISH_PICKUP: '2026-05-10 13:00:00', IGK: 'B1' } as any;

        it('FINISH_PICKUP + MARK_CODES_ENABLED + isMarkSubmittable → вызывает submitFbsMarkCodes', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            submitFbsMarkCodes.mockResolvedValueOnce({ ok: true });
            orderService.getServiceByBuyerId.mockReturnValueOnce({ submitFbsMarkCodes });

            const r = await controller.update(remarkDto as any, finishDto);

            expect(orderService.getServiceByBuyerId).toHaveBeenCalledWith(7, true);
            expect(submitFbsMarkCodes).toHaveBeenCalledWith(invoice);
            expect(r).toEqual({ isSuccess: true, invoice, submit: { ok: true } });
        });

        it('FINISH_PICKUP + MARK_CODES_ENABLED=false → submit не вызывается', async () => {
            markEnabled = false;
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);

            const r = await controller.update(remarkDto as any, finishDto);

            expect(orderService.getServiceByBuyerId).not.toHaveBeenCalled();
            expect(submitFbsMarkCodes).not.toHaveBeenCalled();
            expect(r.submit).toBeUndefined();
        });

        it('FINISH_PICKUP + сервис не реализует IMarkSubmittable → submit не вызывается', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            orderService.getServiceByBuyerId.mockReturnValueOnce({ /* нет submitFbsMarkCodes */ });

            const r = await controller.update(remarkDto as any, finishDto);

            expect(submitFbsMarkCodes).not.toHaveBeenCalled();
            expect(r.submit).toBeUndefined();
        });

        it('FINISH_PICKUP + getServiceByBuyerId=null → submit не вызывается', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            orderService.getServiceByBuyerId.mockReturnValueOnce(null);

            const r = await controller.update(remarkDto as any, finishDto);

            expect(submitFbsMarkCodes).not.toHaveBeenCalled();
            expect(r.submit).toBeUndefined();
        });

        it('submitFbsMarkCodes бросает — ответ не блокируется, submit.ok=false', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            submitFbsMarkCodes.mockRejectedValueOnce(new Error('Ozon 500'));
            orderService.getServiceByBuyerId.mockReturnValueOnce({ submitFbsMarkCodes });

            const r = await controller.update(remarkDto as any, finishDto);

            expect(r.isSuccess).toBe(true);
            expect(r.submit).toEqual({ ok: false, failed: [{ ki: '*', reason: 'Ozon 500' }] });
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
