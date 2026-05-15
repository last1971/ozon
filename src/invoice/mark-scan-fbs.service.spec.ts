import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarkScanFbsService } from './mark-scan-fbs.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { InvoiceDto } from './dto/invoice.dto';

const KI = '010460005100005721ABCDEFGHIJKLM';

describe('MarkScanFbsService', () => {
    let service: MarkScanFbsService;
    const invoiceService = {
        getTransaction: jest.fn(),
        findGoodscodeByKi: jest.fn(),
        attachMarkCodeForFbs: jest.fn(),
        detachMarkCodeForFbs: jest.fn(),
        getStorageSS: jest.fn(),
        getRealpriceLinesByScode: jest.fn(),
        getAttachedMarkCodesByScode: jest.fn(),
        countFreeMarkCodesForGood: jest.fn(),
    };
    const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    const invoice = { id: 100, remark: 'TEST' } as InvoiceDto;
    let migrationEnabled = true;

    beforeEach(async () => {
        Object.values(invoiceService).forEach((m: any) => m.mockReset?.());
        tx.commit.mockReset().mockResolvedValue(undefined);
        tx.rollback.mockReset().mockResolvedValue(undefined);
        invoiceService.getTransaction.mockResolvedValue(tx);
        invoiceService.getStorageSS.mockReturnValue(0);
        migrationEnabled = true;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MarkScanFbsService,
                { provide: INVOICE_SERVICE, useValue: invoiceService },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string, def?: unknown) =>
                            key === 'MARK_CODES_ENABLED' ? migrationEnabled : def,
                    },
                },
            ],
        }).compile();
        service = module.get(MarkScanFbsService);
    });

    describe('scan', () => {
        it('happy path — gc найден, одна rpc, attach с правильными параметрами', async () => {
            invoiceService.findGoodscodeByKi.mockResolvedValueOnce('444');
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 2 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([]);
            invoiceService.countFreeMarkCodesForGood.mockResolvedValue(3);

            const res = await service.scan(invoice, KI);

            expect(invoiceService.attachMarkCodeForFbs).toHaveBeenCalledWith(KI, 500, '444', 0, KI, tx);
            expect(tx.commit).toHaveBeenCalled();
            expect(res.attached).toEqual({ ki: KI, goodscode: '444', realpricecode: 500 });
            expect(res.progress.isReadyToFinish).toBe(false);
        });

        it('две rpc одного gc, первая полна → выбрана вторая', async () => {
            invoiceService.findGoodscodeByKi.mockResolvedValueOnce('444');
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 1 },
                { realpricecode: 501, goodscode: '444', quantity: 2 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([
                { ki: 'OLD', goodscode: '444', realpricecode: 500 },
            ]);
            invoiceService.countFreeMarkCodesForGood.mockResolvedValue(2);

            await service.scan(invoice, KI);

            expect(invoiceService.attachMarkCodeForFbs).toHaveBeenCalledWith(KI, 501, '444', 0, KI, tx);
        });

        it('КМ не найден → 404', async () => {
            invoiceService.findGoodscodeByKi.mockResolvedValueOnce(null);
            await expect(service.scan(invoice, KI)).rejects.toThrow(NotFoundException);
            expect(invoiceService.attachMarkCodeForFbs).not.toHaveBeenCalled();
            expect(tx.rollback).toHaveBeenCalled();
        });

        it('КМ от другого товара → 409', async () => {
            invoiceService.findGoodscodeByKi.mockResolvedValueOnce('999');
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 2 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([]);
            await expect(service.scan(invoice, KI)).rejects.toThrow(ConflictException);
            expect(tx.rollback).toHaveBeenCalled();
        });

        it('лимит исчерпан → 409', async () => {
            invoiceService.findGoodscodeByKi.mockResolvedValueOnce('444');
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 1 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([
                { ki: 'OLD', goodscode: '444', realpricecode: 500 },
            ]);
            await expect(service.scan(invoice, KI)).rejects.toThrow(ConflictException);
        });

        it('SP exception (повторный скан) → 409', async () => {
            invoiceService.findGoodscodeByKi.mockResolvedValueOnce('444');
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 5 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([]);
            invoiceService.attachMarkCodeForFbs.mockRejectedValueOnce(
                new Error('КМ уже привязан к строке счёта.'),
            );
            await expect(service.scan(invoice, KI)).rejects.toThrow(ConflictException);
            expect(tx.rollback).toHaveBeenCalled();
        });
    });

    describe('getProgress', () => {
        it('free=0 → requiresScan=false, isComplete=true', async () => {
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 2 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([]);
            invoiceService.countFreeMarkCodesForGood.mockResolvedValue(0);
            const p = await service.getProgress(invoice);
            expect(p.lines[0]).toMatchObject({ requiresScan: false, isComplete: true, quantityScanned: 0 });
            expect(p.isReadyToFinish).toBe(true);
        });

        it('free<needed → requiresScan=false (товар без КМ)', async () => {
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 3 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([]);
            invoiceService.countFreeMarkCodesForGood.mockResolvedValue(1);
            const p = await service.getProgress(invoice);
            expect(p.lines[0].requiresScan).toBe(false);
            expect(p.isReadyToFinish).toBe(true);
        });

        it('free>=needed → requiresScan=true, неполный → isReadyToFinish=false', async () => {
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 2 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([
                { ki: 'A', goodscode: '444', realpricecode: 500 },
            ]);
            invoiceService.countFreeMarkCodesForGood.mockResolvedValue(2);
            const p = await service.getProgress(invoice);
            expect(p.lines[0]).toMatchObject({
                requiresScan: true, quantityScanned: 1, isComplete: false,
            });
            expect(p.isReadyToFinish).toBe(false);
            expect(p.attachedKis).toEqual(['A']);
        });

        it('смешанный заказ — одна строка требует, одна нет', async () => {
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 1 },
                { realpricecode: 501, goodscode: '555', quantity: 1 },
            ]);
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([
                { ki: 'A', goodscode: '444', realpricecode: 500 },
            ]);
            invoiceService.countFreeMarkCodesForGood
                .mockResolvedValueOnce(2)   // 444 — есть свободные
                .mockResolvedValueOnce(0);  // 555 — нет
            const p = await service.getProgress(invoice);
            expect(p.lines[0]).toMatchObject({ requiresScan: true, isComplete: true });
            expect(p.lines[1]).toMatchObject({ requiresScan: false, isComplete: true });
            expect(p.isReadyToFinish).toBe(true);
        });
    });

    describe('unscan', () => {
        it('attached найден → detach с правильным rpc', async () => {
            invoiceService.getAttachedMarkCodesByScode
                .mockResolvedValueOnce([{ ki: 'A', goodscode: '444', realpricecode: 500 }])
                .mockResolvedValue([]);
            invoiceService.getRealpriceLinesByScode.mockResolvedValue([
                { realpricecode: 500, goodscode: '444', quantity: 1 },
            ]);
            invoiceService.countFreeMarkCodesForGood.mockResolvedValue(2);
            await service.unscan(invoice, 'A');
            expect(invoiceService.detachMarkCodeForFbs).toHaveBeenCalledWith('A', 500, 0, tx);
        });

        it('attached не найден → 404', async () => {
            invoiceService.getAttachedMarkCodesByScode.mockResolvedValue([]);
            await expect(service.unscan(invoice, 'X')).rejects.toThrow(NotFoundException);
            expect(invoiceService.detachMarkCodeForFbs).not.toHaveBeenCalled();
        });
    });

    describe('флаг MARK_CODES_ENABLED выключен', () => {
        beforeEach(() => {
            migrationEnabled = false;
        });

        it('getProgress → пустой прогресс, isReadyToFinish=true, БД не дёргается', async () => {
            const progress = await service.getProgress(invoice);
            expect(progress).toEqual({ lines: [], isReadyToFinish: true, attachedKis: [] });
            expect(invoiceService.getTransaction).not.toHaveBeenCalled();
            expect(invoiceService.getRealpriceLinesByScode).not.toHaveBeenCalled();
            expect(invoiceService.getAttachedMarkCodesByScode).not.toHaveBeenCalled();
            expect(invoiceService.countFreeMarkCodesForGood).not.toHaveBeenCalled();
        });

        it('isReadyToFinish → true без обращения к БД', async () => {
            await expect(service.isReadyToFinish(invoice)).resolves.toBe(true);
            expect(invoiceService.getTransaction).not.toHaveBeenCalled();
        });

        it('scan → 409 без обращения к БД', async () => {
            await expect(service.scan(invoice, KI)).rejects.toThrow(ConflictException);
            expect(invoiceService.findGoodscodeByKi).not.toHaveBeenCalled();
            expect(invoiceService.attachMarkCodeForFbs).not.toHaveBeenCalled();
        });

        it('unscan → 409 без обращения к БД', async () => {
            await expect(service.unscan(invoice, 'A')).rejects.toThrow(ConflictException);
            expect(invoiceService.getAttachedMarkCodesByScode).not.toHaveBeenCalled();
            expect(invoiceService.detachMarkCodeForFbs).not.toHaveBeenCalled();
        });
    });
});
