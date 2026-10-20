import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Trade2006IncomingService } from './trade2006.incoming.service';
import { IncomingStore } from './incoming.store';
import { LoadPendingIncomingCommand } from './commands/load-pending-incoming.command';
import { LoadIncomingGoodsCommand } from './commands/load-incoming-goods.command';
import { RepriceIncomingGoodsCommand } from './commands/reprice-incoming-goods.command';
import { MarkIncomingHandledCommand } from './commands/mark-incoming-handled.command';
import { MpEventService } from '../mp-event/mp-event.service';
import { ExtraPriceService } from '../price/extra.price.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('Trade2006IncomingService (очередь приходов)', () => {
    const journal = {
        listSettledUnhandled: jest.fn().mockResolvedValue([]),
        markHandled: jest.fn().mockResolvedValue(undefined),
    };
    const chainExecute = jest.fn().mockResolvedValue({});
    const prices = { incomingGoodsChain: () => ({ execute: chainExecute }), chainLogger: () => undefined };
    const query = jest.fn().mockResolvedValue([]);
    const transaction = { query, commit: jest.fn(), rollback: jest.fn() };
    const config = { get: jest.fn((k: string, d?: any) => ({ STORAGE_TYPE: 'SKLAD' })[k] ?? d) };
    const events = { emit: jest.fn() };
    let service: Trade2006IncomingService;

    beforeEach(async () => {
        jest.clearAllMocks();
        // Через контейнер Nest: ловит неразрешимые зависимости (урок DonorPiecesStore 16.10).
        const module = await Test.createTestingModule({
            providers: [
                Trade2006IncomingService,
                IncomingStore,
                LoadPendingIncomingCommand,
                LoadIncomingGoodsCommand,
                RepriceIncomingGoodsCommand,
                MarkIncomingHandledCommand,
                { provide: MpEventService, useValue: journal },
                { provide: ExtraPriceService, useValue: prices },
                { provide: ConfigService, useValue: config },
                { provide: FIREBIRD, useValue: { getTransaction: async () => transaction } },
                { provide: EventEmitter2, useValue: events },
            ],
        }).compile();
        service = module.get(Trade2006IncomingService);
    });

    it('очередь пуста — цепочка цен не зовётся, помечать нечего', async () => {
        const ctx = await service.run();
        expect(journal.listSettledUnhandled).toHaveBeenCalledWith('TRADE', 'INCOMING', 'pending', 15);
        expect(chainExecute).not.toHaveBeenCalled();
        expect(journal.markHandled).not.toHaveBeenCalled();
        expect(ctx.stopChain).toBe(true);
    });

    it('два прихода → коды без повторов → цепочка прихода → оба помечены', async () => {
        journal.listSettledUnhandled.mockResolvedValueOnce([
            { extId: '10296', posting: null, firstSeen: new Date() },
            { extId: '10297', posting: null, firstSeen: new Date() },
        ]);
        query.mockResolvedValueOnce([
            { NP: '10296', GOODSCODE: 568615 },
            { NP: '10297', GOODSCODE: 557283 },
            { NP: '10297', GOODSCODE: 568615 },
        ]);
        const ctx = await service.run();
        expect(query.mock.calls[0][0]).toContain('SELECT DISTINCT NP, GOODSCODE FROM SKLADIN WHERE NP IN (?, ?)');
        expect(query.mock.calls[0][1]).toEqual(['10296', '10297']);
        expect(ctx.skus).toEqual(['568615', '557283']);
        expect(chainExecute).toHaveBeenCalledWith(expect.objectContaining({ skus: ['568615', '557283'] }));
        expect(journal.markHandled).toHaveBeenCalledTimes(2);
        expect(journal.markHandled).toHaveBeenCalledWith({
            service: 'TRADE',
            kind: 'INCOMING',
            extId: '10296',
            state: 'pending',
        });
    });

    it('приход без строк — цены не считаем, но заявку закрываем', async () => {
        journal.listSettledUnhandled.mockResolvedValueOnce([{ extId: '10298', posting: null, firstSeen: new Date() }]);
        query.mockResolvedValueOnce([]);
        await service.run();
        expect(chainExecute).not.toHaveBeenCalled();
        expect(journal.markHandled).toHaveBeenCalledTimes(1);
    });

    it('цепочка цен упала — заявки остаются в очереди, run отдаёт null', async () => {
        journal.listSettledUnhandled.mockResolvedValueOnce([{ extId: '10299', posting: null, firstSeen: new Date() }]);
        query.mockResolvedValueOnce([{ NP: '10299', GOODSCODE: 1 }]);
        chainExecute.mockRejectedValueOnce(new Error('Ozon 500'));
        const ctx = await service.run();
        expect(ctx).toBeNull();
        expect(journal.markHandled).not.toHaveBeenCalled();
    });

    it('товара нет на складе — его приход остаётся в очереди, остальные помечены', async () => {
        journal.listSettledUnhandled.mockResolvedValueOnce([
            { extId: '10301', posting: null, firstSeen: new Date() },
            { extId: '10302', posting: null, firstSeen: new Date() },
        ]);
        query.mockResolvedValueOnce([
            { NP: '10301', GOODSCODE: 549853 },
            { NP: '10302', GOODSCODE: 557283 },
        ]);
        chainExecute.mockResolvedValueOnce({
            priceReports: [
                {
                    service: 'OZON',
                    inputs: [],
                    sent: [],
                    response: null,
                    skipped: [
                        { offer_id: '549853-10', reason: 'not-in-stock' },
                        { offer_id: '557283', reason: 'no-free-stock' },
                    ],
                },
            ],
        });
        const ctx = await service.run();
        expect(ctx.heldSkus).toEqual(['549853']);
        expect(journal.markHandled).toHaveBeenCalledTimes(1);
        expect(journal.markHandled).toHaveBeenCalledWith(expect.objectContaining({ extId: '10302' }));
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('товар так и не дошёл до склада за INCOMING_HOLD_HOURS — приход закрыт, письмо в «цены»', async () => {
        journal.listSettledUnhandled.mockResolvedValueOnce([
            { extId: '10303', posting: null, firstSeen: new Date(Date.now() - 3 * 3600 * 1000) },
        ]);
        query.mockResolvedValueOnce([{ NP: '10303', GOODSCODE: 549853 }]);
        chainExecute.mockResolvedValueOnce({
            priceReports: [
                {
                    service: 'OZON',
                    inputs: [],
                    sent: [],
                    response: null,
                    skipped: [{ offer_id: '549853', reason: 'not-in-stock' }],
                },
            ],
        });
        await service.run();
        expect(journal.markHandled).toHaveBeenCalledWith(expect.objectContaining({ extId: '10303' }));
        expect(events.emit).toHaveBeenCalledWith(
            'error.message',
            'Приход: цена не пересчитана',
            expect.stringContaining('приход 10303: 549853'),
            'PRICES',
        );
    });

    it('ручной запуск берёт очередь без ожидания тишины', async () => {
        await service.manualCheck();
        expect(journal.listSettledUnhandled).toHaveBeenCalledWith('TRADE', 'INCOMING', 'pending', 0);
    });

    it('магазин: таблица SHOPIN, NP передаётся числом', async () => {
        config.get.mockImplementation((k: string, d?: any) => ({ STORAGE_TYPE: 'SHOPSKLAD' })[k] ?? d);
        const module = await Test.createTestingModule({
            providers: [
                IncomingStore,
                { provide: ConfigService, useValue: config },
                { provide: FIREBIRD, useValue: { getTransaction: async () => transaction } },
            ],
        }).compile();
        query.mockResolvedValueOnce([
            { NP: 10300, GOODSCODE: 5 },
            { NP: 10300, GOODSCODE: 5 },
        ]);
        const codes = await module.get(IncomingStore).goodsByPrihod(['10300']);
        expect(query.mock.calls[0][0]).toContain('FROM SHOPIN WHERE NP IN (?)');
        expect(query.mock.calls[0][1]).toEqual([10300]);
        expect(codes).toEqual(new Map([['10300', ['5']]]));
    });
});
