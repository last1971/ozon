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
        query.mockResolvedValueOnce([{ GOODSCODE: 568615 }, { GOODSCODE: 557283 }]);
        const ctx = await service.run();
        expect(query.mock.calls[0][0]).toContain('FROM SKLADIN WHERE NP IN (?, ?)');
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
        query.mockResolvedValueOnce([{ GOODSCODE: 1 }]);
        chainExecute.mockRejectedValueOnce(new Error('Ozon 500'));
        const ctx = await service.run();
        expect(ctx).toBeNull();
        expect(journal.markHandled).not.toHaveBeenCalled();
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
        query.mockResolvedValueOnce([{ GOODSCODE: 5 }, { GOODSCODE: 5 }]);
        const codes = await module.get(IncomingStore).goodsOfPrihods(['10300']);
        expect(query.mock.calls[0][0]).toContain('FROM SHOPIN WHERE NP IN (?)');
        expect(query.mock.calls[0][1]).toEqual([10300]);
        expect(codes).toEqual(['5']);
    });
});
