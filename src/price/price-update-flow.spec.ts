import * as checkpoints from '../job/job.checkpoint';
import { PromoPriceApplier } from '../promos/price-lever/promo-price.applier';
import { ApplySweepCommand } from '../promos/price-lever/sweep/apply-sweep.command';
import { PromoPricePlan } from '../promos/price-lever/promo-price.types';
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
        seller: null,
        ozonActions: [],
    },
    steps: [{ kind: 'percent', actionId: 1, sku: Number(id), from: 0, to: 10 }],
});
it('реальный sweep пропускает ручную отправку между товарами; ВБ работает во время ожидания Ozon', async () => {
    const order: string[] = [],
        block = gate();
    const ids = ['99001', '99002', '99003'];
    const snapshots = new Map(ids.map((id) => [id, priceUpdateQueue.capture('ozon', [id])]));
    const setPercent = jest.fn(async (_, rows) => {
        const id = String(rows[0].sku);
        order.push(id);
        if (id === ids[0]) await block.wait;
        return { applied: rows, rejected: [] };
    });
    const products = {
        getPrices: jest.fn(async ({ offer_id }) => ({
            items: offer_id.map((offer_id) => ({
                offer_id,
                product_id: Number(offer_id),
                price: { price: '200', min_price: '100', old_price: '300', marketing_seller_price: '200' },
            })),
        })),
    };
    const applier = new PromoPriceApplier({} as any, { setPercent } as any, {} as any, products as any);
    const context = {
        apply: true,
        goal: 'min' as const,
        plans: ids.map(plan),
        pricingSnapshots: snapshots,
        progress: emptyProgress(),
    };
    const sweep = new ApplySweepCommand(applier).execute(context);
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
    await Promise.all([sweep, jobs.whenDone(sending.id)]);
    expect(order).toEqual([ids[0], 'wb', 'manual', ids[2]]);
    expect(context['results'][1]).toMatchObject({ offerId: ids[1], applied: false });
    expect(context['results'][1].results[0].reason).toContain('устарел');
});
it('смена цены в самом Ozon отклоняет старый план до первого изменения акции', async () => {
    const update = jest.fn(),
        setPercent = jest.fn();
    const applier = new PromoPriceApplier(
        { update } as any,
        { setPercent } as any,
        {} as any,
        {
            getPrices: async () => ({
                items: [
                    {
                        offer_id: '99004',
                        product_id: 99004,
                        price: { price: '999', min_price: '100', old_price: '300', marketing_seller_price: '200' },
                    },
                ],
            }),
        } as any,
    );
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
