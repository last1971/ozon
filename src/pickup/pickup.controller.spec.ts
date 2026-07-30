import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PickupController } from './pickup.controller';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MarkScanFbsService } from '../invoice/mark-scan-fbs.service';
import { OrderService } from '../order/order.service';
import { InvoiceDto } from '../invoice/dto/invoice.dto';

describe('PickupController', () => {
    let controller: PickupController;
    const invoiceService = { update: jest.fn(), pickupInvoice: jest.fn() };
    const markScan = { isReadyToFinish: jest.fn() };
    const orderService = {
        submitFbsMarkCodesForInvoice: jest.fn(),
        prepareFbsMarksForInvoice: jest.fn(),
        getShipmentLabelForInvoice: jest.fn(),
        getShipmentBarcodeForInvoice: jest.fn(),
    };
    const invoice = { id: 100, remark: 'TEST', buyerId: 7 } as InvoiceDto;
    const remarkDto = { remark: 'TEST', invoice };

    beforeEach(async () => {
        invoiceService.update.mockReset();
        invoiceService.pickupInvoice.mockReset();
        markScan.isReadyToFinish.mockReset();
        orderService.submitFbsMarkCodesForInvoice.mockReset();
        orderService.prepareFbsMarksForInvoice.mockReset();
        orderService.getShipmentLabelForInvoice.mockReset();
        orderService.getShipmentBarcodeForInvoice.mockReset();
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

    describe('update (PUT) — фиксация сборки, без передачи КМ', () => {
        it('без FINISH_PICKUP — update проходит, gating и submit не трогаются', async () => {
            invoiceService.update.mockResolvedValueOnce(true);
            const r = await controller.update(remarkDto as any, { START_PICKUP: '2026-05-10 12:00:00' } as any);
            expect(r).toEqual({ isSuccess: true, invoice });
            expect(markScan.isReadyToFinish).not.toHaveBeenCalled();
            expect(orderService.submitFbsMarkCodesForInvoice).not.toHaveBeenCalled();
        });

        it('FINISH_PICKUP + ready=false → BadRequest, update не вызывается', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(false);
            await expect(
                controller.update(remarkDto as any, { FINISH_PICKUP: '2026-05-10 13:00:00' } as any),
            ).rejects.toThrow(BadRequestException);
            expect(invoiceService.update).not.toHaveBeenCalled();
        });

        it('FINISH_PICKUP + ready=true → пишет IGK/время, КМ НЕ передаёт', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.update.mockResolvedValueOnce(true);
            const dto = { FINISH_PICKUP: '2026-05-10 13:00:00', IGK: 'B1' } as any;

            const r = await controller.update(remarkDto as any, dto);

            expect(invoiceService.update).toHaveBeenCalledWith(invoice, dto);
            expect(orderService.submitFbsMarkCodesForInvoice).not.toHaveBeenCalled();
            expect(r).toEqual({ isSuccess: true, invoice });
        });

        it('FINISH_PICKUP: IGK != эталонный ШК → BadRequest, update не вызывается', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            orderService.getShipmentBarcodeForInvoice.mockResolvedValueOnce('SHK-999');
            const dto = { FINISH_PICKUP: '2026-05-10 13:00:00', IGK: 'SHK-000' } as any;

            await expect(controller.update(remarkDto as any, dto)).rejects.toThrow(BadRequestException);
            expect(invoiceService.update).not.toHaveBeenCalled();
        });

        it('FINISH_PICKUP: IGK == эталонный ШК → update проходит', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            orderService.getShipmentBarcodeForInvoice.mockResolvedValueOnce('SHK-777');
            invoiceService.update.mockResolvedValueOnce(true);
            const dto = { FINISH_PICKUP: '2026-05-10 13:00:00', IGK: 'SHK-777' } as any;

            const r = await controller.update(remarkDto as any, dto);

            expect(invoiceService.update).toHaveBeenCalledWith(invoice, dto);
            expect(r).toEqual({ isSuccess: true, invoice });
        });

        it('FINISH_PICKUP: эталон отсутствует (ВБ) → сверка пропускается, update проходит', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            orderService.getShipmentBarcodeForInvoice.mockResolvedValueOnce(undefined);
            invoiceService.update.mockResolvedValueOnce(true);
            const dto = { FINISH_PICKUP: '2026-05-10 13:00:00', IGK: 'anything' } as any;

            const r = await controller.update(remarkDto as any, dto);

            expect(invoiceService.update).toHaveBeenCalledWith(invoice, dto);
            expect(r).toEqual({ isSuccess: true, invoice });
        });
    });

    describe('pick (POST /pick) — подбор счёта', () => {
        it('ready=false → BadRequest, pickupInvoice не вызывается', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(false);
            await expect(controller.pick(remarkDto as any)).rejects.toThrow(BadRequestException);
            expect(invoiceService.pickupInvoice).not.toHaveBeenCalled();
        });

        it('ready=true → pickupInvoice, { isSuccess: true }', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            invoiceService.pickupInvoice.mockResolvedValueOnce(undefined);
            const r = await controller.pick(remarkDto as any);
            expect(invoiceService.pickupInvoice).toHaveBeenCalledWith(invoice, null);
            expect(r).toEqual({ isSuccess: true });
        });
    });

    describe('label (GET /label) — этикетка отправления стр.1', () => {
        it('отдаёт PDF inline через res', async () => {
            const pdf = Buffer.from('%PDF-fake');
            orderService.getShipmentLabelForInvoice.mockResolvedValueOnce(pdf);
            const res = { setHeader: jest.fn(), send: jest.fn() } as any;

            await controller.label(remarkDto as any, res);

            expect(orderService.getShipmentLabelForInvoice).toHaveBeenCalledWith(invoice);
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
            expect(res.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                `inline; filename=${invoice.remark}.pdf`,
            );
            expect(res.send).toHaveBeenCalledWith(pdf);
        });
    });

    describe('prepareMarks (POST /marks/prepare) — предпроверка', () => {
        it('пробрасывает результат prepareFbsMarksForInvoice как { prepare }', async () => {
            const prepare = { ok: true, multiBoxQty: 1, lines: [] };
            orderService.prepareFbsMarksForInvoice.mockResolvedValueOnce(prepare);

            const r = await controller.prepareMarks(remarkDto as any);

            expect(orderService.prepareFbsMarksForInvoice).toHaveBeenCalledWith(invoice);
            expect(r).toEqual({ prepare });
        });

        it('prepare undefined (ВБ / флаг выкл) → { prepare: undefined }', async () => {
            orderService.prepareFbsMarksForInvoice.mockResolvedValueOnce(undefined);
            const r = await controller.prepareMarks(remarkDto as any);
            expect(r).toEqual({ prepare: undefined });
        });
    });

    describe('submitMarks (POST /marks) — передача КМ (+ГТД)', () => {
        it('ready=false → BadRequest, submit не вызывается', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(false);
            await expect(controller.submitMarks(remarkDto as any)).rejects.toThrow(BadRequestException);
            expect(orderService.submitFbsMarkCodesForInvoice).not.toHaveBeenCalled();
        });

        it('ready=true → передаёт КМ, возвращает { submit }', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            orderService.submitFbsMarkCodesForInvoice.mockResolvedValueOnce({ ok: true });

            const r = await controller.submitMarks(remarkDto as any);

            expect(markScan.isReadyToFinish).toHaveBeenCalledWith(invoice);
            expect(orderService.submitFbsMarkCodesForInvoice).toHaveBeenCalledWith(invoice);
            expect(r).toEqual({ submit: { ok: true } });
        });

        it('submit undefined (флаг выкл / не submittable) → { submit: undefined }', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            orderService.submitFbsMarkCodesForInvoice.mockResolvedValueOnce(undefined);

            const r = await controller.submitMarks(remarkDto as any);

            expect(r).toEqual({ submit: undefined });
        });

        it('submit ok=false → пробрасывается', async () => {
            markScan.isReadyToFinish.mockResolvedValueOnce(true);
            const failure = { ok: false, failed: [{ ki: '*', reason: 'Ozon 500' }] };
            orderService.submitFbsMarkCodesForInvoice.mockResolvedValueOnce(failure);

            const r = await controller.submitMarks(remarkDto as any);

            expect(r).toEqual({ submit: failure });
        });
    });
});
