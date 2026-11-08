import { CheckLossPriceStockCommand } from '../marketplace-loss/prices/check-loss-price-stock.command';
import { ConfigService } from '@nestjs/config';
import { ExtraPriceService } from '../price/extra.price.service';
import { ExtraGoodService } from '../good/extra.good.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { JobService } from '../job/job.service';
import { MarketPriceWorkflowService } from '../marketplace-loss/prices/market-price-workflow.service';
import {
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
} from '../marketplace-loss/prices/loss-price.commands';
import { IncomingPricesCommand } from '../price/commands/incoming-prices.command';
import { ValidateSkusNotEmptyCommand } from '../price/commands/validate-skus-not-empty.command';
import { TradeSkusCommand } from '../price/commands/trade-skus.command';
import { ResetAvailablePriceCommand } from '../price/commands/reset-available-price.command';
import { SetResultProcessingMessageCommand } from '../price/commands/set-result-processing-message.command';
import { LogResultProcessingMessageCommand } from '../price/commands/log-result-processing-message.command';
import { Trade2006IncomingService } from './trade2006.incoming.service';
import { LoadPendingIncomingCommand } from './commands/load-pending-incoming.command';
import { LoadIncomingGoodsCommand } from './commands/load-incoming-goods.command';
import { RepriceIncomingGoodsCommand } from './commands/reprice-incoming-goods.command';
import { MarkIncomingHandledCommand } from './commands/mark-incoming-handled.command';

function setup() {
    const pending = new Map(
        ['123', '456'].map((id) => [id, { extId: id, firstSeen: new Date(), version: 'v1', payload: {} }]),
    );
    const journal = {
        listUnhandledRows: jest.fn(async () => [...pending.values()]),
        isCurrentVersion: jest.fn(async (event, version) => pending.get(event.extId)?.version === version),
        finishVersion: jest.fn(async (event, version, payload, handled) => {
            const row = pending.get(event.extId);
            if (!row || row.version !== version) return false;
            if (handled) pending.delete(event.extId);
            else row.payload = structuredClone(payload);
            return true;
        }),
    };
    const current = new Map<string, any>();
    const goods = {
        resetAvailablePrice: jest.fn(async () => {}),
        setPercents: jest.fn(),
        buildPriceables: jest.fn(async (_, ids) =>
            ids.map((offer_id) => ({
                offer_id,
                incoming_price: 100,
                available_price: 0,
                min_perc: 20,
                perc: 40,
                old_perc: 80,
                adv_perc: 0,
                sum_pack: 0,
                sales_percent: 20,
                fbs_direct_flow_trans_max_amount: 10,
            })),
        ),
    };
    const adapter = {
        availability: jest.fn(async (ids: string[]) => new Map(ids.map(id => [id, { state: 'available' as const, marketplace: 0 }]))),
        pricing: {
            getObtainCoeffs: () => ({ minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 }),
        },
        offers: jest.fn(),
        current: async () => new Map(current),
        persist: jest.fn(async () => {}),
        matches: (a, b) => !!b && ['price', 'old_price', 'min_price'].every((key) => a[key] === b[key]),
        send: jest.fn(async (targets) => {
            targets.forEach((t) => current.set(t.offer_id, t));
            return new Map(targets.map((t) => [t.offer_id, null]));
        }),
        promos: jest.fn(async (offers) => new Map(offers.map((id) => [id, null]))),
    };
    const catalog = Object.create(ExtraGoodService.prototype);
    catalog.getCountUpdateableService = () => ({ skuList: ['123', '456', '999'] });
    catalog.whenSkuListsReady = async () => {};
    catalog.isSkuListAvailable = () => true;
    catalog.listServices = () => [{ service: GoodServiceEnum.OZON, isSwitchedOn: true }];
    const config = new ConfigService({ PRICE_VERIFY_DELAY_MS: 0 });
    function restart() {
        const workflow = new MarketPriceWorkflowService(
            new JobService(),
            { OZON: adapter, WB: adapter } as any,
            new CalculateLossPriceTargetsCommand(goods as any),
            new CompareLossPricesCommand(),
            new SendLossPricesCommand(),
            new ConfirmLossPricesCommand(config),
            new CheckLossPricePromosCommand(),
        new CheckLossPriceStockCommand(),
        );
        const extra = Object.assign(Object.create(ExtraPriceService.prototype), {
            services: new Map([[GoodServiceEnum.OZON, adapter.pricing]]),
            logger: { log: jest.fn(), error: jest.fn() },
            validateSkusNotEmptyCommand: new ValidateSkusNotEmptyCommand(),
            tradeSkusCommand: new TradeSkusCommand(catalog),
            resetAvailablePriceCommand: new ResetAvailablePriceCommand(goods as any),
            setResultProcessingMessageCommand: new SetResultProcessingMessageCommand(),
            logResultProcessingMessageCommand: new LogResultProcessingMessageCommand(),
        });
        extra.incomingPricesCommand = new IncomingPricesCommand(extra, catalog, workflow);
        return {
            extra,
            service: new Trade2006IncomingService(
                config,
                new LoadPendingIncomingCommand(journal as any),
                new LoadIncomingGoodsCommand({
                    goodsByPrihod: async (ids) => new Map(ids.map((id) => [id, [id]])),
                } as any),
                new RepriceIncomingGoodsCommand(extra, journal as any),
                new MarkIncomingHandledCommand(journal as any),
            ),
        };
    }
    return { ...restart(), restart, pending, journal, adapter, goods };
}
it('вся цепочка ждёт акций; приход не закрывается раньше подтверждения', async () => {
    const s = setup();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entered = new Promise<void>((resolve) => (started = resolve));
    s.adapter.promos.mockImplementationOnce(async (offers) => {
        started();
        await gate;
        return new Map(offers.map((id) => [id, null]));
    });
    const running = s.service.run();
    await entered;
    expect(s.journal.finishVersion).not.toHaveBeenCalled();
    expect(s.adapter.offers).not.toHaveBeenCalled();
    expect(s.adapter.send.mock.calls.flatMap((call) => call[0]).map((t) => t.offer_id)).toEqual(['123', '456']);
    release();
    const ctx = await running;
    expect(ctx.completed).toEqual(['123', '456']);
    expect(ctx.pending).toEqual([]);
    expect(s.goods.setPercents).not.toHaveBeenCalled();
});
it('частичный отказ и рестарт: успешный приход закрыт, оставшийся завершается без повторной цены', async () => {
    const s = setup();
    s.adapter.promos.mockResolvedValueOnce(
        new Map([
            ['123', { message: 'Отказ акции', kind: 'temporary' }],
            ['456', null],
        ]) as any,
    );
    const first = await s.service.run();
    expect(first.completed).toEqual(['456']);
    expect(first.pending[0].np).toBe('123');
    expect((s.pending.get('123').payload as any).incoming.pending[0]).toContain('Отказ акции');
    const second = await s.restart().service.run();
    expect(second.completed).toEqual(['123']);
    expect(s.pending.size).toBe(0);
    expect(s.adapter.send).toHaveBeenCalledTimes(2); // По одному запросу на товар, только в первом проходе.
    expect(s.adapter.promos.mock.calls[1][0]).toEqual(['123']);
});
it('изменение документа во время акций сохраняет новую версию для следующего прохода', async () => {
    const s = setup();
    s.adapter.promos.mockImplementationOnce(async (offers) => {
        s.pending.get('123').version = 'v2';
        return new Map(offers.map((id) => [id, null]));
    });
    const ctx = await s.service.run();
    expect(ctx.completed).toEqual(['456']);
    expect(ctx.pending[0]).toMatchObject({ np: '123', reasons: [expect.stringContaining('изменился')] });
    expect(s.pending.get('123').version).toBe('v2');
});
it('ручной путь возвращает ошибку при незавершённых действиях, а не ложный успех', async () => {
    const s = setup();
    s.adapter.promos.mockResolvedValueOnce(new Map([['123', 'Отказ акции']]) as any);
    await expect(s.extra.handleIncomingGoods(['123'])).rejects.toThrow('Отказ акции');
});
