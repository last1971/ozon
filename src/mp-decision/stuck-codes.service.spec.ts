import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MpEventService } from '../mp-event/mp-event.service';
import { StuckCodesService } from './stuck-codes.service';

describe('StuckCodesService — еженедельный отчёт «подвисшие коды»', () => {
    let service: StuckCodesService;
    const findStuckMarkCodes = jest.fn();
    const findByPosting = jest.fn();
    const emit = jest.fn();
    const listUnhandled = jest.fn();
    const listStatesForPosting = jest.fn();
    const markHandled = jest.fn();
    let markCodesEnabled = true;

    const row = (over: any = {}) => ({
        ki: '0100400000013930215fajB',
        goodscode: '531557',
        status: 5,
        transferType: 3,
        scode: 91933,
        invoiceNumber: 5577,
        prim: '33261943-0361-1 закрыт',
        invoiceStatus: 5,
        invoiceDate: new Date(Date.now() - 10 * 24 * 3600 * 1000),
        ...over,
    });

    beforeEach(async () => {
        markCodesEnabled = true;
        [findStuckMarkCodes, findByPosting, emit, listUnhandled, listStatesForPosting, markHandled].forEach((m) =>
            m.mockReset(),
        );
        listUnhandled.mockResolvedValue([]);
        listStatesForPosting.mockResolvedValue([]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StuckCodesService,
                { provide: INVOICE_SERVICE, useValue: { findStuckMarkCodes, findByPosting } },
                { provide: ConfigService, useValue: { get: () => markCodesEnabled } },
                { provide: EventEmitter2, useValue: { emit } },
                { provide: MpEventService, useValue: { listUnhandled, listStatesForPosting, markHandled } },
            ],
        }).compile();
        service = module.get(StuckCodesService);
    });

    it('маркировка выключена (магазин) → в MARKCODES не ходим, но ожидания отмен проверяем', async () => {
        markCodesEnabled = false;
        await service.report();
        expect(findStuckMarkCodes).not.toHaveBeenCalled();
        expect(listUnhandled).toHaveBeenCalledWith('OZON', 'CANCEL_WAIT');
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
        expect(body).toContain('счёт №5577 (SCODE 91933)');
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

    describe('напоминалка «отменённые без возврата» (CANCEL_WAIT)', () => {
        const wait = (over: any = {}) => ({
            extId: '72067989-0727-1',
            posting: '72067989-0727-1',
            firstSeen: new Date(Date.now() - 7 * 24 * 3600 * 1000),
            ...over,
        });
        const match = (over: any = {}) => ({
            invoice: { id: 91694, status: 4 },
            mark: '',
            cancelled: false,
            closed: false,
            ...over,
        });

        beforeEach(() => {
            findStuckMarkCodes.mockResolvedValue([]);
            findByPosting.mockResolvedValue(match());
        });

        it('заявки возврата нет дольше порога → письмо «проверить в кабинете»', async () => {
            listUnhandled.mockResolvedValue([wait()]);
            listStatesForPosting.mockResolvedValue([]);

            await service.report();

            const call = emit.mock.calls.find((c) => String(c[1]).startsWith('Отменённые без возврата'));
            expect(call[1]).toBe('Отменённые без возврата: 1');
            expect(call[2]).toContain('заявки возврата НЕТ');
        });

        it('заявка отклонена (Rejected) — физики не будет: считаем как «заявки нет»', async () => {
            listUnhandled.mockResolvedValue([wait()]);
            listStatesForPosting.mockResolvedValue(['Rejected']);

            await service.report();

            const call = emit.mock.calls.find((c) => String(c[1]).startsWith('Отменённые без возврата'));
            expect(call[2]).toContain('заявки возврата НЕТ');
        });

        it('товар не доедет (Utilized) → ожидание закрывается навсегда, письма нет', async () => {
            listUnhandled.mockResolvedValue([wait({ firstSeen: new Date(Date.now() - 30 * 24 * 3600 * 1000) })]);
            listStatesForPosting.mockResolvedValue(['MovingToOzon', 'Utilized']);

            await service.report();

            expect(markHandled).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'CANCEL_WAIT', extId: '72067989-0727-1' }),
            );
            expect(emit).not.toHaveBeenCalled();
        });

        it('возврат приехал к нам (ReceivedBySeller) → «ждёт расформирования», ожидание живо', async () => {
            listUnhandled.mockResolvedValue([wait()]);
            listStatesForPosting.mockResolvedValue(['MovingToSeller', 'ReceivedBySeller']);

            await service.report();

            expect(markHandled).not.toHaveBeenCalled();
            const call = emit.mock.calls.find((c) => String(c[1]).startsWith('Отменённые без возврата'));
            expect(call[2]).toContain('ждёт расформирования');
            expect(call[2]).not.toContain('склада не достигла');
        });

        it('заявка есть и едет в пределах двух недель → не шумим', async () => {
            listUnhandled.mockResolvedValue([wait()]);
            listStatesForPosting.mockResolvedValue(['MovingToOzon']);

            await service.report();

            expect(emit).not.toHaveBeenCalled();
        });

        it('заявка есть, но склада не достигла за две недели → письмо «завис в пути»', async () => {
            listUnhandled.mockResolvedValue([wait({ firstSeen: new Date(Date.now() - 15 * 24 * 3600 * 1000) })]);
            listStatesForPosting.mockResolvedValue(['MovingToOzon']);

            await service.report();

            const call = emit.mock.calls.find((c) => String(c[1]).startsWith('Отменённые без возврата'));
            expect(call[2]).toContain('возврат завис в пути');
        });

        it('счёт помечен (возврат разобрал) → ожидание закрывается, письма нет', async () => {
            listUnhandled.mockResolvedValue([wait()]);
            findByPosting.mockResolvedValue(match({ mark: ' отмена FBO', cancelled: true, invoice: { id: 91694, status: 1 } }));

            await service.report();

            expect(markHandled).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'CANCEL_WAIT', extId: '72067989-0727-1' }),
            );
            expect(emit).not.toHaveBeenCalled();
        });

        it('счёт погашен ручным расформированием → тоже закрываем', async () => {
            listUnhandled.mockResolvedValue([wait()]);
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 0 } }));

            await service.report();

            expect(markHandled).toHaveBeenCalled();
            expect(emit).not.toHaveBeenCalled();
        });

        it('свежая отмена без заявки (моложе порога) → пока не шумим', async () => {
            listUnhandled.mockResolvedValue([wait({ firstSeen: new Date(Date.now() - 2 * 24 * 3600 * 1000) })]);
            listStatesForPosting.mockResolvedValue([]);

            await service.report();

            expect(emit).not.toHaveBeenCalled();
        });
    });
});
