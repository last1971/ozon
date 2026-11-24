import * as checkpoints from '../job/job.checkpoint';
import { OzonPriceTransitionService } from '../promos/price-lever/ozon-price-transition.service';
import { PromoPriceApplier } from '../promos/price-lever/promo-price.applier';
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
// The only test doubles here are the marketplace, the economic inputs and durable storage.
function transitions(states: Map<string, PromoPriceState>, sendPercent: (sku: string) => Promise<void>) {
    const reader = {
        allStates: async (ids: string[]) => ids.map((id) => structuredClone(states.get(id))),
        states: async (ids: string[]) => ids.map((id) => structuredClone(states.get(id))),
    };
    const enrich = { enrichBatch: async () => {}, enrichOne: async () => ({ status: 'ready' }) };
    const tickets = new Map<string, { token: string; payload: unknown }>();
    const journal = {
        versions: async () => new Map([...tickets].map(([key, entry]) => [key, entry.token])),
        pending: async (id: string) => tickets.get(id),
        claim: async (id: string, payload: unknown) => {
            if (tickets.has(id)) throw new Error('Повторная отправка до подтверждения');
            const ticket = { token: id, payload: structuredClone(payload) };
            tickets.set(id, ticket);
            return ticket;
        },
        finish: async (id: string, token: string) => tickets.get(id)?.token === token && tickets.delete(id),
    };
    const update = jest.fn();
    const setPercent = jest.fn(async (_action: number, rows: { sku: number; percent: number }[]) => {
        const { sku, percent } = rows[0];
        const id = String(sku);
        await sendPercent(id);
        const current = states.get(id);
        current.seller.percent = percent;
        current.buyerPrice = current.buyerPriceCalc = (current.price * (100 - percent)) / 100;
        return { applied: rows, rejected: [] };
    });
    const service = new OzonPriceTransitionService(
        { get: () => reader } as any,
        enrich as any,
        journal as any,
        {} as any,
        { update } as any,
        { setPercent } as any,
    );
    return { applier: new PromoPriceApplier(service), reader, enrich, setPercent, update };
}
it('реальный sweep пропускает ручную отправку между товарами; ВБ работает во время ожидания Ozon', async () => {
    const order: string[] = [],
        block = gate();
    const ids = ['99001', '99002', '99003'];
    const snapshots = new Map(ids.map((id) => [id, priceUpdateQueue.capture('ozon', [id])]));
    const states = new Map(ids.map((id) => [id, plan(id).state]));
    const { applier, reader, enrich, setPercent } = transitions(states, async (id) => {
        order.push(id);
        if (id === ids[0]) await block.wait;
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
            // The freshly installed marketplace minimum now prevents a retry of the obsolete promotion.
            states.get(ids[1]).minPrice = 190;
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
    await Promise.all([sweep, jobs.whenDone(sending.id)]);
    expect(order).toEqual([ids[0], 'wb', 'manual', ids[2]]);
    expect(context['results'][1]).toMatchObject({ offerId: ids[1], applied: false });
    expect(context['results'][1].stale).toBe(true);
    expect(context['results'][1].notes.join(' ')).toContain('минимум Ozon');
});
it('смена цены в самом Ozon отклоняет старый план до первого изменения акции', async () => {
    const stale = plan('99004');
    const states = new Map([[stale.offerId, { ...stale.state, price: 999 }]]);
    const { applier, update, setPercent } = transitions(states, async () => {});
    expect(await applier.apply(plan('99004'))).toMatchObject({ applied: false });
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
