import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PickupController } from './pickup.controller';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MarkScanFbsService } from '../invoice/mark-scan-fbs.service';
import { OrderService } from '../order/order.service';
import { InvoiceDto } from '../invoice/dto/invoice.dto';

describe('PickupController', () => {
    let controller: PickupController;
    const invoiceService = { update: jest.fn() };
    const markScan = { isReadyToFinish: jest.fn() };
    const orderService = { submitFbsMarkCodesForInvoice: jest.fn() };
    const invoice = { id: 100, remark: 'TEST', buyerId: 7 } as InvoiceDto;
    const remarkDto = { remark: 'TEST', invoice };

    beforeEach(async () => {
        invoiceService.update.mockReset();
        markScan.isReadyToFinish.mockReset();
        orderService.submitFbsMarkCodesForInvoice.mockReset();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: INVOICE_SERVICE, useValue: invoiceService },
                { provide: MarkScanFbsService, useValue: markScan },
                { provide: OrderService, useValue: orderService },
            ],
            controllers: [PickupController],
        }).compile();
        controller = module.get(PickupController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('update — FINISH_PICKUP gating', () => {
        it('без FINISH_PICKUP — обновление проходит, isReadyToFinish/submit не вызываются', async () => {
            invoiceService.update.mockResolvedValueOnce(true);
            const r = await controller.update(remarkDto as any, { START_PICKUP: '2026-05-10 12:00:00' } as any);
            expect(r).toEqual({ isSuccess: true, invoice, submit: undefined });
            expect(markScan.isReadyToFinish).not.toHaveBeenCalled();
            expect(orderService.submitFbsMarkCodesForInvoice).not.toHaveBeenCalled();
        });

        it('с FINISH_PICKUP и ready=false → BadRequestException, update/submit не вызываются', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(false);
            await expect(
                controller.update(remarkDto as any, { FINISH_PICKUP: '2026-05-10 13:00:00' } as any),
            ).rejects.toThrow(BadRequestException);
            expect(invoiceService.update).not.toHaveBeenCalled();
            expect(orderService.submitFbsMarkCodesForInvoice).not.toHaveBeenCalled();
        });
    });

    describe('update — submit оркестрация', () => {
        const finishDto = { FINISH_PICKUP: '2026-05-10 13:00:00', IGK: 'B1' } as any;

        it('FINISH_PICKUP + ready=true → invoiceService.update и submitFbsMarkCodesForInvoice вызываются', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            orderService.submitFbsMarkCodesForInvoice.mockResolvedValueOnce({ ok: true });

            const r = await controller.update(remarkDto as any, finishDto);

            expect(markScan.isReadyToFinish).toHaveBeenCalledWith(invoice);
            expect(invoiceService.update).toHaveBeenCalledWith(invoice, finishDto);
            expect(orderService.submitFbsMarkCodesForInvoice).toHaveBeenCalledWith(invoice);
            expect(r).toEqual({ isSuccess: true, invoice, submit: { ok: true } });
        });

        it('submitFbsMarkCodesForInvoice вернул undefined (флаг выкл / не submittable) → submit=undefined', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            orderService.submitFbsMarkCodesForInvoice.mockResolvedValueOnce(undefined);

            const r = await controller.update(remarkDto as any, finishDto);

            expect(orderService.submitFbsMarkCodesForInvoice).toHaveBeenCalledWith(invoice);
            expect(r).toEqual({ isSuccess: true, invoice, submit: undefined });
        });

        it('submitFbsMarkCodesForInvoice вернул ok=false → пробрасывается в submit', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            const failure = { ok: false, failed: [{ ki: '*', reason: 'Ozon 500' }] };
            orderService.submitFbsMarkCodesForInvoice.mockResolvedValueOnce(failure);

            const r = await controller.update(remarkDto as any, finishDto);

            expect(r).toEqual({ isSuccess: true, invoice, submit: failure });
        });
    });
});
