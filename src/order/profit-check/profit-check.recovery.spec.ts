import { ConfigService } from '@nestjs/config';
import { ProfitCheckService } from './profit-check.service';
import { LoadPendingCommand } from './commands/load-pending.command';
import { ResolveSalePricesCommand } from './commands/resolve-sale-prices.command';
import { FallbackSalePricesCommand } from './commands/fallback-sale-prices.command';
import { LoadPriceContextCommand } from './commands/load-price-context.command';
import { EvaluateCommand } from './commands/evaluate.command';
import { NotifyCommand } from './commands/notify.command';
import { MarkHandledCommand } from './commands/mark-handled.command';
const input = (offer_id = '123') => ({
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
});
const coeffs = { minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 };
const row = (posting: string, offers = ['123']) => ({
    extId: posting,
    firstSeen: new Date(),
    payload: {
        service: 'WB',
        buyerId: 1,
        scode: 1,
        invoiceNumber: null,
        externalId: posting,
        priceSource: 'posting',
        lines: offers.map((offer_id) => ({ offer_id, units: 1, pricePerUnit: 80 })),
    },
});
function setup(rows = [row('one')]) {
    const pending = new Map(rows.map((r) => [r.extId, structuredClone(r)]));
    const journal = {
        listUnhandledRows: jest.fn(async (service) => (service === 'WB' ? [...pending.values()] : [])),
        markHandled: jest.fn(async ({ extId }) => {
            pending.delete(extId);
        }),
        updatePendingPayload: jest.fn(async ({ extId }, payload) => {
            pending.get(extId)!.payload = structuredClone(payload);
        }),
    };
    const pricing = { getObtainCoeffs: () => coeffs };
    const prices = { getService: jest.fn(() => pricing) };
    const goods = { buildPriceables: jest.fn(async (_, ids, _prices?: any, _onSkip?: any) => ids.map(input)) };
    const source = { lookupSalePrices: jest.fn(), fallbackSalePrices: jest.fn() };
    const sources = { of: () => source };
    const events = { emit: jest.fn() };
    const service = new ProfitCheckService(
        journal as any,
        sources as any,
        new ConfigService(),
        new LoadPendingCommand(journal as any),
        new ResolveSalePricesCommand(sources as any),
        new FallbackSalePricesCommand(sources as any),
        new LoadPriceContextCommand(prices as any, goods as any),
        new EvaluateCommand(),
        new NotifyCommand(events as any),
        new MarkHandledCommand(journal as any),
    );
    const run = () => service.chain().execute({ items: [], lookupHours: 3, warnPercent: 1 });
    return { service, run, journal, prices, pricing, goods, source, events, pending };
}
it('сбой чтения включённой площадки не называется отключением и остаётся для повтора', async () => {
    const s = setup();
    s.goods.buildPriceables.mockRejectedValueOnce(new Error('ECONNRESET'));
    const failed = await s.run();
    expect(failed.items[0].reason).not.toContain('выключена');
    expect(failed.items[0].deferred).toBe(true);
    expect(s.pending.size).toBe(1);
    expect(s.journal.markHandled).not.toHaveBeenCalled();
    await s.run();
    expect(s.pending.size).toBe(0);
});
it('ошибка одного товара не назначается исправному заказу той же площадки', async () => {
    const s = setup([row('one'), row('two', ['456'])]);
    s.goods.buildPriceables.mockImplementationOnce(async (_, ids, _prices, onSkip) => {
        onSkip({ offer_id: '456', reason: 'no-base' });
        return [input('123')];
    });
    const ctx = await s.run();
    expect(ctx.items[0].level).toBe('alert');
    expect(ctx.items[1].verdicts?.[0].reason).toContain('себестоимости');
    expect(ctx.items[1].reason ?? '').not.toContain('выключена');
});
it('временная ошибка статистики после трёх часов не закрывает заказ как отсутствие цены', async () => {
    const initial = row('one');
    initial.firstSeen = new Date(Date.now() - 4 * 3600_000);
    initial.payload.priceSource = 'lookup';
    const s = setup([initial]);
    s.source.lookupSalePrices.mockRejectedValueOnce(new Error('API 503'));
    const ctx = await s.run();
    expect(ctx.items[0].deferred).toBe(true);
    expect(s.journal.markHandled).not.toHaveBeenCalled();
    expect(s.source.fallbackSalePrices).not.toHaveBeenCalled();
});

it('действительно отключённая площадка получает отдельную причину и завершается', async () => {
    const s = setup();
    s.prices.getService.mockReturnValueOnce(null);
    const ctx = await s.run();
    expect(ctx.items[0]).toMatchObject({ level: 'skip', reason: 'площадка выключена на этом узле', deferred: false });
    expect(s.goods.buildPriceables).not.toHaveBeenCalled();
    expect(s.pending.size).toBe(0);
});
it('смешанный заказ проверяет исправную строку сразу и не повторяет её уведомление', async () => {
    const s = setup([row('one', ['123', '456'])]);
    const unavailable = async (_: any, _ids: any, _prices: any, onSkip: any) => {
        onSkip({ offer_id: '456', reason: 'pricing-data', failureKind: 'temporary', message: 'API 503' });
        return [input('123')];
    };
    s.goods.buildPriceables.mockImplementationOnce(unavailable).mockImplementationOnce(unavailable);
    const first = await s.run();
    expect(first.items[0]).toMatchObject({ deferred: true, level: 'alert' });
    expect(first.items[0].verdicts).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ offer_id: '123', level: 'alert' }),
            expect.objectContaining({ offer_id: '456', failureKind: 'temporary', retryable: true }),
        ]),
    );
    expect(s.events.emit).toHaveBeenCalledTimes(1);
    expect(s.pending.size).toBe(1);
    await s.run();
    expect(s.events.emit).toHaveBeenCalledTimes(1);
    expect(s.journal.updatePendingPayload).toHaveBeenCalledTimes(1);
    const recovered = await s.run();
    expect(recovered.items[0].verdicts.map((v) => v.offer_id)).toEqual(['456']);
    expect(s.pending.size).toBe(0);
    expect(s.events.emit).toHaveBeenCalledTimes(2);
});
it('повтор хранит исходную цену покупателя, а оценка использует найденную цену продавца', async () => {
    const initial = row('one');
    initial.payload.priceSource = 'lookup';
    const s = setup([initial]);
    s.source.lookupSalePrices.mockResolvedValue(new Map([['one', [{ offer_id: '123', units: 1, pricePerUnit: 120 }]]]));
    s.goods.buildPriceables.mockRejectedValueOnce(new Error('API 503'));
    const ctx = await s.run();
    expect(ctx.items[0].payload.lines[0].pricePerUnit).toBe(120);
    expect(s.pending.get('one')!.payload.lines[0].pricePerUnit).toBe(80);
    expect((s.pending.get('one')!.payload as any).check.retryReason).toContain('API 503');
    const recovered = await s.run();
    expect(recovered.items[0].verdicts[0].pricePerUnit).toBe(120);
    expect(s.pending.size).toBe(0);
});
it('временный сбой карточки после истечения срока также остаётся для повтора', async () => {
    const initial = row('one');
    initial.payload.priceSource = 'lookup';
    initial.firstSeen = new Date(Date.now() - 4 * 3600_000);
    const s = setup([initial]);
    s.source.lookupSalePrices.mockResolvedValue(new Map());
    s.source.fallbackSalePrices.mockRejectedValueOnce(new Error('API 429'));
    const ctx = await s.run();
    expect(ctx.items[0]).toMatchObject({ deferred: true, level: 'skip' });
    expect(ctx.items[0].reason).toContain('карточки');
    expect(s.pending.size).toBe(1);
    expect(s.journal.markHandled).not.toHaveBeenCalled();
    s.source.fallbackSalePrices.mockResolvedValueOnce(new Map([['one', initial.payload.lines]]));
    expect((await s.run()).items[0].payload.priceOrigin).toBe('card');
    expect(s.pending.size).toBe(0);
});
it('ошибка целой пачки не отменяет следующую пачку', async () => {
    const ids = Array.from({ length: 101 }, (_, n) => String(n));
    const s = setup(ids.map((id) => row(`order-${id}`, [id])));
    s.goods.buildPriceables.mockRejectedValueOnce(new Error('API timeout'));
    const ctx = await s.run();
    expect(s.goods.buildPriceables).toHaveBeenCalledTimes(2);
    expect(ctx.items.filter((i) => i.deferred)).toHaveLength(100);
    expect(ctx.items[100]).toMatchObject({ level: 'alert', deferred: false });
    expect(s.pending.size).toBe(100);
});
it('повреждённые данные не объявляются отключением или временной ошибкой', async () => {
    const s = setup();
    s.goods.buildPriceables.mockImplementationOnce(async (_, _ids, _prices, onSkip) => {
        onSkip({ offer_id: '123', reason: 'pricing-data', failureKind: 'data', message: 'нет тарифа WB' });
        return [];
    });
    const ctx = await s.run();
    expect(ctx.items[0].verdicts[0]).toMatchObject({
        level: 'skip',
        failureKind: 'invalid-data',
        retryable: false,
        reason: 'нет тарифа WB',
    });
    expect(s.pending.size).toBe(0);
});
