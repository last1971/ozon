import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { StuckCodesService } from './stuck-codes.service';

describe('StuckCodesService — еженедельный отчёт «подвисшие коды»', () => {
    let service: StuckCodesService;
    const findStuckMarkCodes = jest.fn();
    const emit = jest.fn();
    let markCodesEnabled = true;

    const row = (over: any = {}) => ({
        ki: '0100400000013930215fajB',
        goodscode: '531557',
        status: 5,
        transferType: 3,
        scode: 91933,
        prim: '33261943-0361-1 закрыт',
        invoiceStatus: 5,
        invoiceDate: new Date(Date.now() - 10 * 24 * 3600 * 1000),
        ...over,
    });

    beforeEach(async () => {
        markCodesEnabled = true;
        [findStuckMarkCodes, emit].forEach((m) => m.mockReset());
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StuckCodesService,
                { provide: INVOICE_SERVICE, useValue: { findStuckMarkCodes } },
                { provide: ConfigService, useValue: { get: () => markCodesEnabled } },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get(StuckCodesService);
    });

    it('маркировка выключена (магазин) → в базу не ходим вовсе', async () => {
        markCodesEnabled = false;
        await service.report();
        expect(findStuckMarkCodes).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('висяков нет → письма нет', async () => {
        findStuckMarkCodes.mockResolvedValue([]);
        await service.report();
        expect(emit).not.toHaveBeenCalled();
    });

    it('висяки есть → письмо со списком, состоянием и возрастом', async () => {
        findStuckMarkCodes.mockResolvedValue([row()]);
        await service.report();
        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toBe('Подвисшие коды: 1');
        expect(body).toContain('0100400000013930215fajB');
        expect(body).toContain('TT=3');
        expect(body).toContain('счёт 91933');
        expect(body).toContain('возраст 10 дн');
    });

    it('длинный список обрезается, но не молча', async () => {
        findStuckMarkCodes.mockResolvedValue(Array.from({ length: 205 }, (_, i) => row({ ki: `KI-${i}` })));
        await service.report();
        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toBe('Подвисшие коды: 205');
        expect(body).toContain('и ещё 5 кодов');
    });

    it('сбой чтения → письмо о сбое, а не тишина', async () => {
        findStuckMarkCodes.mockRejectedValue(new Error('DB down'));
        await service.report();
        expect(emit).toHaveBeenCalledWith('error.message', 'Отчёт «подвисшие коды» не собран', 'DB down');
    });
});
