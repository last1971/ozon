import { OzonPriceWriter } from './ozon-price-writer';
import { OzonActionSlot, PromoPricePlan, PromoPriceState, PromoPriceStep } from './promo-price.types';

const slot = (over: Partial<OzonActionSlot> = {}): OzonActionSlot => ({
    actionId: 1,
    title: 'Бустинг',
    isVoucher: false,
    participant: true,
    actionPrice: 90,
    maxActionPrice: 120,
    stock: 3,
    startsAt: null,
    ...over,
});
const state = (id: number, over: Partial<PromoPriceState> = {}): PromoPriceState => ({
    offerId: String(id),
    productId: id,
    price: 200,
    oldPrice: 300,
    minPrice: 150,
    calcMinPrice: 150,
    buyerPrice: 90,
    buyerPriceCalc: 90,
    seller: null,
    ozonActions: [slot()],
    ...over,
});
const remove = (actionId = 1): PromoPriceStep => ({ kind: 'ozon-remove', actionId, title: 'Бустинг', from: 90, reason: '' });
const plan = (s: PromoPriceState, steps: PromoPriceStep[]): PromoPricePlan => ({
    offerId: s.offerId,
    productId: s.productId,
    target: 150,
    percent: 0,
    floor: 150,
    steps,
    buyerBefore: s.buyerPrice,
    baseAfter: 200,
    buyerAfter: 200,
    ok: true,
    closest: false,
    notes: [],
    state: s,
});

function writer(states: PromoPriceState[]) {
    const reader = { allStates: jest.fn(async (ids: string[]) => states.filter((s) => ids.includes(s.offerId))), forget: jest.fn() };
    const actions = {
        update: jest.fn(async (_id: number, rows: { productId: number }[]) => ({
            added: [],
            removed: rows.map((r) => r.productId).filter((id) => id !== 3),
            unchanged: [],
            rejected: rows.some((r) => r.productId === 3) ? [{ productId: 3, reason: 'Ozon отказал' }] : [],
            warnings: [],
        })),
        deactivate: jest.fn(async (_id: number, ids: number[]) => ids),
    };
    const products = { setPrice: jest.fn() };
    const seller = { setPercent: jest.fn() };
    const w = new OzonPriceWriter({ get: () => reader } as any, products as any, actions as any, seller as any, { emitAsync: jest.fn() } as any);
    return { w, reader, actions, products, seller };
}

it('товары одной акции снимаются одним запросом ценой выше лимита, отказ Ozon — у своего товара', async () => {
    const states = [state(1), state(2), state(3)];
    const { w, actions, reader } = writer(states);
    const results = await w.applyPromos(states.map((s) => plan(s, [remove()])));
    expect(actions.update).toHaveBeenCalledTimes(1);
    expect(actions.update).toHaveBeenCalledWith(1, [
        { productId: 1, actionPrice: 121, stock: 3 },
        { productId: 2, actionPrice: 121, stock: 3 },
        { productId: 3, actionPrice: 121, stock: 3 },
    ]);
    expect(results.map((r) => r.applied)).toEqual([true, true, false]);
    expect(results[2].results[0]).toMatchObject({ status: 'rejected', reason: 'Ozon отказал' });
    expect(reader.allStates).toHaveBeenCalledTimes(1);
    expect(reader.forget).toHaveBeenCalledWith([1, 2, 3]);
});

it('промокод снимается только deactivate', async () => {
    const s = state(5, { ozonActions: [slot({ actionId: 7, isVoucher: true })] });
    const { w, actions } = writer([s]);
    const [result] = await w.applyPromos([plan(s, [remove(7)])]);
    expect(actions.deactivate).toHaveBeenCalledWith(7, [5]);
    expect(actions.update).not.toHaveBeenCalled();
    expect(result.applied).toBe(true);
});

it('цена в Ozon поменялась после плана — ничего не пишем, план устарел', async () => {
    const planned = state(1);
    const { w, actions } = writer([state(1, { buyerPrice: 95, buyerPriceCalc: 95 })]);
    const [result] = await w.applyPromos([plan(planned, [remove()])]);
    expect(actions.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ applied: false, stale: true, attempted: false });
});

it('база ниже минимальной с нашим процентом: сначала процент, база — следующим проходом', async () => {
    const s = state(8, {
        price: 200,
        buyerPrice: 180,
        buyerPriceCalc: 180,
        ozonActions: [],
        seller: { actionId: 9, title: 'Наша', minPercent: 5, sku: 8, percent: 10, isActive: true },
    });
    const { w, products, seller } = writer([s]);
    seller.setPercent.mockResolvedValue({ applied: [{ sku: 8, percent: 6 }], rejected: [] });
    const [row] = await w.updateBases([
        { offer_id: '8', currency_code: 'RUB', price: '160', min_price: '150', old_price: '300' },
    ]);
    expect(products.setPrice).not.toHaveBeenCalled();
    expect(seller.setPercent).toHaveBeenCalledWith(9, [{ sku: 8, percent: 6 }]);
    expect(row).toMatchObject({ updated: false, transition: 'pending' });
});
