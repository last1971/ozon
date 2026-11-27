import * as checkpoints from '../job/job.checkpoint';
import { OzonPriceWriter } from '../promos/price-lever/ozon-price-writer';
import { ApplySweepCommand } from '../promos/price-lever/sweep/apply-sweep.command';
import { PromoPricePlan, PromoPriceState } from '../promos/price-lever/promo-price.types';
import { PreparePriceReviewCommand, SendPriceReviewCommand } from './price-review.commands';
import { PriceReviewService } from './price-review.service';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
import { emptyProgress } from '../interfaces/i.job.context';
import { JobService } from '../job/job.service';

const gate = () => {
    let open: () => void;
    const wait = new Promise<void>((r) => (open = r));
    return { wait, open: () => open() };
};
const plan = (id: string): PromoPricePlan => ({
    offerId: id,
    productId: Number(id),
    target: 180,
    percent: 10,
    floor: 100,
    buyerBefore: 200,
    baseAfter: 200,
    buyerAfter: 180,
    ok: true,
    closest: false,
    notes: [],
    state: {
        offerId: id,
        productId: Number(id),
        oldPrice: 300,
        price: 200,
        minPrice: 100,
        buyerPrice: 200,
        buyerPriceCalc: 200,
        calcMinPrice: 100,
        calculationKey: 'tariffs',
        seller: { actionId: 1, sku: Number(id), title: 'Скидка', percent: 0, minPercent: 5, isActive: true },
        ozonActions: [],
    },
    steps: [{ kind: 'percent', actionId: 1, sku: Number(id), from: 0, to: 10 }],
});
// The only test doubles here are the marketplace and the economic inputs.
function transitions(states: Map<string, PromoPriceState>, sendPercent: (skus: string[]) => Promise<void>) {
    const reader = {
        allStates: async (ids: string[]) => ids.map((id) => structuredClone(states.get(id))),
        states: async (ids: string[]) => ids.map((id) => structuredClone(states.get(id))),
        forget: () => {},
    };
    const enrich = { enrichBatch: async () => new Map(), enrichOne: async () => ({ status: 'ready' }) };
    const update = jest.fn();
    const setPercent = jest.fn(async (_action: number, rows: { sku: number; percent: number }[]) => {
        await sendPercent(rows.map((r) => String(r.sku)));
        for (const { sku, percent } of rows) {
            const current = states.get(String(sku));
            current.seller.percent = percent;
            current.buyerPrice = current.buyerPriceCalc = (current.price * (100 - percent)) / 100;
        }
        return { applied: rows, rejected: [] };
    });
    const writer = new OzonPriceWriter(
        { get: () => reader } as any,
        {} as any,
        { update } as any,
        { setPercent } as any,
        { emitAsync: async () => [] } as any,
    );
    return { applier: writer, reader, enrich, setPercent, update };
}
it('сверка пишет пачкой одной операцией очереди Ozon: ВБ не ждёт, ручная цена Ozon после неё устарела и не уходит', async () => {
    const order: string[] = [],
        block = gate();
    const ids = ['99001', '99002', '99003'];
    const snapshots = new Map(ids.map((id) => [id, priceUpdateQueue.capture('ozon', [id])]));
    const states = new Map(ids.map((id) => [id, plan(id).state]));
    const { applier, reader, enrich, setPercent } = transitions(states, async (skus) => {
        order.push(skus.join(','));
        await block.wait;
    });
    const context = {
        apply: true,
        goal: 'min' as const,
        plans: ids.map(plan),
        pricingSnapshots: snapshots,
        progress: emptyProgress(),
    };
    const sweep = new ApplySweepCommand(applier, reader as any, enrich as any).execute(context);
    while (!order.length) await new Promise(setImmediate);
    const coeffs = { minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 };
    const ozon = {
        getObtainCoeffs: () => coeffs,
        updatePrices: jest.fn(async () => {
            order.push('manual');
            return { result: [{ offer_id: ids[1], updated: true }] };
        }),
    };
    const wb = {
        getObtainCoeffs: () => coeffs,
        updatePrices: jest.fn(async () => {
            order.push('wb');
            return {};
        }),
    };
    const extra = { getService: (name) => (name === 'ozon' ? ozon : name === 'wb' ? wb : null) };
    const goods = {
        buildPriceables: async () => [
            {
                offer_id: ids[1],
                incoming_price: 100,
                min_perc: 20,
                perc: 40,
                old_perc: 80,
                available_price: 0,
                adv_perc: 0,
                sum_pack: 0,
                sales_percent: 20,
                fbs_direct_flow_trans_max_amount: 10,
            },
        ],
    };
    const jobs = new JobService(),
        prepare = new PreparePriceReviewCommand(extra as any, goods as any);
    const service = new PriceReviewService(jobs, prepare, new SendPriceReviewCommand(extra as any, prepare));
    const review: any = (await jobs.whenDone(service.prepareReview(ids[1]).id)).result;
    const sending = service.sendReview(review.token);
    while (!wb.updatePrices.mock.calls.length) await new Promise(setImmediate);
    expect(ozon.updatePrices).not.toHaveBeenCalled();
    expect(setPercent).toHaveBeenCalledTimes(1);
    block.open();
    const [, sent] = await Promise.all([sweep, jobs.whenDone(sending.id)]);
    expect(order).toEqual([ids.join(','), 'wb']);
    expect(ozon.updatePrices).not.toHaveBeenCalled();
    expect((sent.result as any).entries[0]).toMatchObject({ service: 'ozon', status: 'skipped', error: expect.stringContaining('устарел') });
    expect(context['results'].map((r) => r.applied)).toEqual([true, true, true]);
});
it('смена цены в самом Ozon отклоняет старый план до первого изменения акции', async () => {
    const stale = plan('99004');
    const states = new Map([[stale.offerId, { ...stale.state, price: 999 }]]);
    const { applier, update, setPercent } = transitions(states, async () => {});
    expect(await applier.applyPromo(plan('99004'))).toMatchObject({ applied: false, stale: true });
    expect(update).not.toHaveBeenCalled();
    expect(setPercent).not.toHaveBeenCalled();
});

it('отмена ожидает уже начатую запись другой площадки, не помечая задачу завершённой раньше ответа', async () => {
    const block = gate(),
        cancelBoundary = gate();
    const rows = [{ offer_id: '99301', price: '200', min_price: '100', old_price: '300', currency_code: 'RUB' }];
    const context: any = {
        offerId: '99301',
        entries: [
            { service: 'ozon', prices: rows },
            { service: 'wb', prices: rows },
        ],
        progress: emptyProgress(),
    };
    let checkpointsCalled = 0;
    const checkpoint = jest.spyOn(checkpoints, 'jobCheckpoint').mockImplementation(async (ctx) => {
        // Второй участник останавливается на границе отмены, пока первый уже ждёт ответа API.
        if (++checkpointsCalled === 2) {
            await cancelBoundary.wait;
            if (ctx?.stopChain) throw new Error('Задача остановлена');
        }
    });
    try {
        const ozon = {
            updatePrices: jest.fn(async () => {
                context.stopChain = true;
                await block.wait;
                return { result: [{ offer_id: '99301', updated: true }] };
            }),
        };
        const wb = { updatePrices: jest.fn() };
        const send = new SendPriceReviewCommand(
            { getService: (name) => (name === 'ozon' ? ozon : wb) } as any,
            { entry: async () => ({ prices: rows }) } as any,
        );
        let finished = false;
        const sending = send.execute(context);
        const done = sending.then(
            () => {
                finished = true;
            },
            () => {
                finished = true;
            },
        );
        while (!ozon.updatePrices.mock.calls.length) await new Promise(setImmediate);
        cancelBoundary.open();
        await new Promise(setImmediate);
        expect(finished).toBe(false);
        expect(wb.updatePrices).not.toHaveBeenCalled();
        block.open();
        await expect(sending).rejects.toThrow('остановлена');
        await done;
    } finally {
        block.open();
        cancelBoundary.open();
        checkpoint.mockRestore();
    }
});
