import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
const coeffs = { minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 };
const input = (offer_id: string) => ({
    offer_id,
    incoming_price: 100,
    min_perc: 20,
    perc: 40,
    old_perc: 80,
    available_price: 0,
    adv_perc: 0,
    sum_pack: 0,
    sales_percent: 20,
    fbs_direct_flow_trans_max_amount: 10,
});
it('массовый сбор остаётся пакетным, а ручная запись проходит между товарами и защищена от старой пачки', async () => {
    const goods = Object.create(Trade2006GoodService.prototype) as Trade2006GoodService;
    const ids = ['99201', '99202', '99203'],
        order: string[] = [];
    const collect = jest.fn(async () => ({ priceables: ids.map(input), skipped: [] }));
    (goods as any).collectPriceables = collect;
    let release: () => void;
    const service = {
        priceUpdateKey: 'ozon',
        getObtainCoeffs: () => coeffs,
        updatePrices: jest.fn(async (rows) => {
            const id = rows[0].offer_id;
            order.push(id);
            if (id === ids[0]) await new Promise<void>((r) => (release = r));
            return { result: rows.map((p) => ({ offer_id: p.offer_id, updated: true })) };
        }),
    };
    const bulk = goods.repriceForService(service as any, ids);
    while (!release) await new Promise(setImmediate);
    const manual = priceUpdateQueue.run(
        'ozon',
        async () => {
            order.push('manual');
            priceUpdateQueue.changed('ozon', [ids[1]]);
        },
        { priority: 'manual' },
    );
    release();
    await manual;
    const result = await bulk;
    expect(order).toEqual([ids[0], 'manual', ids[2]]);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(result.sent.map((p) => p.offer_id)).toEqual([ids[0], ids[2]]);
    expect(result.skipped).toEqual([
        expect.objectContaining({ offer_id: ids[1], message: expect.stringContaining('устарел') }),
    ]);
});
it('поздняя ошибка отправки одного товара сохраняет его отказ и результат соседей', async () => {
    const goods = Object.create(Trade2006GoodService.prototype) as Trade2006GoodService;
    const ids = ['99211', '99212'];
    (goods as any).collectPriceables = async () => ({ priceables: ids.map(input), skipped: [] });
    const service = {
        priceUpdateKey: 'ozon',
        getObtainCoeffs: () => coeffs,
        updatePrices: jest.fn(async ([row]) => {
            if (row.offer_id === ids[0]) throw new Error('timeout after request');
            return { result: [{ offer_id: row.offer_id, updated: true }] };
        }),
    };
    const result = await goods.repriceForService(service as any, ids);
    expect(result.skipped).toEqual([]);
    expect(result.response.result).toEqual([
        expect.objectContaining({ offer_id: ids[0], updated: false }),
        { offer_id: ids[1], updated: true },
    ]);
});
