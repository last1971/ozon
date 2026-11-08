import { CheckLossPriceStockCommand } from './check-loss-price-stock.command';
import { ConfigService } from '@nestjs/config';
import { JobService } from '../../job/job.service';
import { calculatePrice } from '../../helpers/price/price.helpers';
import { priceUpdateQueue } from '../../helpers/price/price-update.queue';
import { MarketPriceWorkflowService } from './market-price-workflow.service';
import {
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
} from './loss-price.commands';
const input = (offer_id: string) => ({
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
function setup() {
    const current = new Map<string, any>();
    const goods = {
        buildPriceables: jest.fn(async (_service, ids: string[], _prices?: any, _onSkip?: any) => ids.map(input)),
    };
    const adapter = {
        availability: jest.fn(async (ids: string[]) => new Map(ids.map(id => [id, { state: 'available' as const, marketplace: 0 }]))),
        pricing: { getObtainCoeffs: () => coeffs },
        offers: jest.fn(async () => {
            throw Error('Нельзя обходить каталог');
        }),
        current: jest.fn(async () => new Map(current)),
        matches: (a, b) => !!b && ['price', 'old_price', 'min_price'].every((key) => a[key] === b[key]),
        persist: jest.fn(async () => {}),
        send: jest.fn(async (targets) => {
            for (const target of targets) current.set(target.offer_id, target);
            return new Map(targets.map((t) => [t.offer_id, null]));
        }),
        promos: jest.fn(async (offers) => new Map(offers.map((id) => [id, null]))),
    };
    const jobs = new JobService();
    const workflow = new MarketPriceWorkflowService(
        jobs,
        { OZON: adapter, WB: adapter } as any,
        new CalculateLossPriceTargetsCommand(goods as any),
        new CompareLossPricesCommand(),
        new SendLossPricesCommand(),
        new ConfirmLossPricesCommand(new ConfigService({ PRICE_VERIFY_DELAY_MS: 0 })),
        new CheckLossPricePromosCommand(),
        new CheckLossPriceStockCommand(),
    );
    return { workflow, goods, adapter, current, jobs };
}
it('адресный приход: общие формулы → подтверждение → акции, без обхода каталога', async () => {
    const s = setup();
    s.adapter.promos.mockImplementationOnce(async (offers) => {
        expect(s.adapter.current).toHaveBeenCalledTimes(2);
        expect(s.adapter.send).toHaveBeenCalledTimes(1);
        expect(offers).toEqual(['123-2']);
        return new Map([['123-2', null]]);
    });
    expect(await s.workflow.incoming('OZON', ['123-2'])).toEqual([{ offerId: '123-2' }]);
    expect(s.adapter.offers).not.toHaveBeenCalled();
    expect(s.adapter.send.mock.calls[0][0]).toEqual([calculatePrice(input('123-2'), coeffs)]);
});
it('смешанная пачка: ошибка одного артикула не отменяет другой', async () => {
    const s = setup();
    s.goods.buildPriceables.mockImplementationOnce(async (_service, _ids, _prices, onSkip) => {
        onSkip({ offer_id: '123', reason: 'no-base' });
        return [input('456')];
    });
    const rows = await s.workflow.incoming('WB', ['123', '456']);
    expect(rows[0]).toMatchObject({ offerId: '123', error: expect.any(String) });
    expect(rows[1]).toEqual({ offerId: '456' });
    expect(s.adapter.send.mock.calls[0][0].map((t) => t.offer_id)).toEqual(['456']);
    expect(s.adapter.promos.mock.calls[0][0]).toEqual(['456']);
});
it('отказ цены не запускает акцию, остаётся конкретная причина', async () => {
    const s = setup();
    s.adapter.send.mockResolvedValueOnce(new Map([['123', { message: 'Отказ API', kind: 'data' }]]) as any);
    expect(await s.workflow.incoming('OZON', ['123'])).toEqual([{ offerId: '123', error: 'Отказ API' }]);
    expect(s.adapter.promos).not.toHaveBeenCalled();
});
it('принятый запрос без совпадения фактической цены не закрывает работу', async () => {
    const s = setup();
    s.adapter.send.mockResolvedValueOnce(new Map([['123', null]]));
    expect((await s.workflow.incoming('WB', ['123']))[0].error).toContain('не подтвердила');
    expect(s.adapter.promos).not.toHaveBeenCalled();
});
it('отказ акции: следующий проход после перезапуска не отправляет уже принятую цену', async () => {
    const s = setup();
    s.adapter.promos.mockResolvedValueOnce(new Map([['123', { message: 'Отказ акции', kind: 'temporary' }]]) as any);
    expect((await s.workflow.incoming('OZON', ['123']))[0].error).toBe('Отказ акции');
    const restarted = new MarketPriceWorkflowService(
        new JobService(),
        { OZON: s.adapter, WB: s.adapter } as any,
        new CalculateLossPriceTargetsCommand(s.goods as any),
        new CompareLossPricesCommand(),
        new SendLossPricesCommand(),
        new ConfirmLossPricesCommand(new ConfigService({ PRICE_VERIFY_DELAY_MS: 0 })),
        new CheckLossPricePromosCommand(),
        new CheckLossPriceStockCommand(),
    );
    expect(await restarted.incoming('OZON', ['123'])).toEqual([{ offerId: '123' }]);
    expect(s.adapter.send).toHaveBeenCalledTimes(1);
    expect(s.adapter.promos).toHaveBeenCalledTimes(2);
});
it('данные документа изменились в ожидании очереди: старую цену не отправляем', async () => {
    const s = setup();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const blocker = priceUpdateQueue.run('ozon', async () => {
        started();
        await gate;
    });
    await entered;
    let valid = true;
    const running = s.workflow.incoming('OZON', ['123'], async () => {
        if (!valid) throw Error('Приход изменился');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    valid = false;
    release();
    await blocker;
    expect((await running)[0].error).toBe('Приход изменился');
    expect(s.adapter.send).not.toHaveBeenCalled();
    expect(s.adapter.promos).not.toHaveBeenCalled();
});
it('новая версия читает свежие входы и пересчитывается, наценки не записываются', async () => {
    const s = setup();
    await s.workflow.incoming('WB', ['123']);
    s.goods.buildPriceables.mockResolvedValueOnce([{ ...input('123'), incoming_price: 200 }]);
    await s.workflow.incoming('WB', ['123']);
    expect(s.adapter.send).toHaveBeenCalledTimes(2);
    expect(Number(s.adapter.send.mock.calls[1][0][0].min_price)).toBeGreaterThan(
        Number(s.adapter.send.mock.calls[0][0][0].min_price),
    );
});
