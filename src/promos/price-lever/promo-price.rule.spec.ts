import { buyerPrice } from '../../helpers/price/buyer.price.helper';
import { OzonPriceWriter } from './ozon-price-writer';
import { effectiveMinimum, guardPlan, limitPrice, planOzonPrice, sellerPercent } from './promo-price.planner';
import { PromoPriceService } from './promo-price.service';
import { PromoPriceState, SellerSlot } from './promo-price.types';

const seller = (over: Partial<SellerSlot> = {}): SellerSlot => ({
    actionId: 9,
    title: '26-11',
    minPercent: 5,
    actionOn: true,
    sku: 1,
    percent: 5,
    isActive: true,
    ...over,
});
const state = (over: Partial<PromoPriceState> = {}): PromoPriceState => ({
    offerId: '537572',
    productId: 570690546,
    price: 5110,
    minPrice: 5110,
    oldPrice: 7257,
    buyerPrice: 4854,
    buyerPriceCalc: 4854,
    seller: seller(),
    ozonActions: [],
    ...over,
});

describe('правило цены Ozon', () => {
    it('пример владельца: минимальная 500, наш процент 5 → предельная 526 (Ozon округляет 499,7 до 500)', () => {
        expect(limitPrice(500, 5)).toBe(526);
        expect(buyerPrice(526, [], 5)).toBe(500);
        expect(buyerPrice(525, [], 5)).toBeLessThan(500);
        expect(limitPrice(500, 0)).toBe(500);
    });

    it('процент: участник — не ниже минимального акции; не участник — 0', () => {
        expect(sellerPercent(seller({ percent: 5 }))).toBe(5);
        expect(sellerPercent(seller({ percent: 3 }))).toBe(5);
        expect(sellerPercent(seller({ percent: 12 }))).toBe(12);
        expect(sellerPercent(seller({ isActive: false }))).toBe(0);
        expect(sellerPercent(null)).toBe(0);
    });

    it('537572 сегодня: ограничение 5110 при включённой акции 5% давало 4854 — план поднимает предельную', () => {
        const plan = planOzonPrice(state(), 5527, 7257);
        expect(plan.price).toBe(limitPrice(5527, 5));
        expect(plan.steps).toEqual([
            {
                kind: 'base',
                target: {
                    currency_code: 'RUB',
                    offer_id: '537572',
                    price: String(plan.price),
                    min_price: '5527',
                    old_price: '7257',
                },
            },
        ]);
        expect(plan.buyerAfter).toBeGreaterThanOrEqual(5527);
        expect(plan.ok).toBe(true);
    });

    it('акция выключена — цена считается с её процентом: включение не уведёт ниже минимальной', () => {
        const off = state({ seller: seller({ actionOn: false }), buyerPrice: 5110, buyerPriceCalc: 5110 });
        expect(planOzonPrice(off, 5527, 7257).price).toBe(limitPrice(5527, 5));
    });

    it('нашей акции нет (следующий месяц) — предельная равна минимальной', () => {
        const none = state({ seller: null });
        const plan = planOzonPrice(none, 5527, 7257);
        expect(plan.price).toBe(5527);
        expect(plan.buyerAfter).toBe(5527);
    });

    it('процент выше минимального: вниз до минимального, предельная по текущему — ниже минимальной не уходит', () => {
        const deep = state({ seller: seller({ percent: 20 }) });
        const plan = planOzonPrice(deep, 1000, 1500);
        expect(plan.price).toBe(limitPrice(1000, 20));
        expect(plan.steps).toContainEqual({ kind: 'percent', actionId: 9, sku: 1, from: 20, to: 5 });
        expect(buyerPrice(plan.price, [], 20)).toBeGreaterThanOrEqual(1000);
    });

    it('цена уже по правилу — шагов нет', () => {
        const done = state({ price: limitPrice(5527, 5), minPrice: 5527, oldPrice: 7257 });
        expect(planOzonPrice(done, 5527, 7257).steps).toEqual([]);
    });

    it('нет минимальной — ничего не шлём', () => {
        const plan = planOzonPrice(state({ minPrice: 0 }), 0, 0);
        expect(plan.steps).toEqual([]);
        expect(plan.ok).toBe(false);
    });

    it('тариф P300: выше 300 — не ниже верхней ступени', () => {
        expect(effectiveMinimum(310, 330)).toBe(330);
        expect(effectiveMinimum(250, 330)).toBe(250);
        expect(effectiveMinimum(400, undefined)).toBe(400);
    });
});

describe('писатель цен', () => {
    function writer(states: PromoPriceState[]) {
        const reader = {
            pricedStates: jest.fn(async (ids: string[]) => states.filter((s) => ids.includes(s.offerId))),
            forget: jest.fn(),
        };
        const order: string[] = [];
        const products = {
            setPrice: jest.fn(async ({ prices }) => {
                order.push('price');
                return { result: prices.map((p) => ({ offer_id: p.offer_id, updated: true })) };
            }),
        };
        const sellerApi = {
            setPercent: jest.fn(async (_id: number, rows: { sku: number }[]) => {
                order.push('percent');
                return { applied: rows, rejected: [] };
            }),
        };
        const w = new OzonPriceWriter({ get: () => reader } as any, products as any, sellerApi as any);
        return { w, reader, products, sellerApi, order };
    }

    it('пересчёт: предельная по правилу пачкой, процент первым, в акции Ozon не пишет', async () => {
        const a = state({ offerId: '1', productId: 1, seller: seller({ sku: 1, percent: 10 }) });
        const b = state({ offerId: '2', productId: 2, seller: null });
        const { w, products, sellerApi, order, reader } = writer([a, b]);
        const rows = await w.updateBases([
            {
                offer_id: '1',
                currency_code: 'RUB',
                price: '9000',
                min_price: '5527',
                old_price: '7257',
                ozonCalculated: true,
            },
            { offer_id: '2', currency_code: 'RUB', price: '9000', min_price: '5527', old_price: '7257' },
        ]);
        expect(rows.map((r) => r.updated)).toEqual([true, true]);
        expect(order).toEqual(['percent', 'price']);
        expect(sellerApi.setPercent).toHaveBeenCalledWith(9, [{ sku: 1, percent: 5 }]);
        expect(products.setPrice).toHaveBeenCalledTimes(1);
        const sent = products.setPrice.mock.calls[0][0].prices;
        expect(sent.map((p) => [p.offer_id, p.price, p.min_price])).toEqual([
            ['1', String(limitPrice(5527, 10)), '5527'],
            ['2', '5527', '5527'],
        ]);
        expect(sent[0].ozonCalculated).toBeUndefined();
        expect(reader.forget).toHaveBeenCalledWith([1, 2]);
    });

    it('план сверки устарел (цена в Ozon сменилась) — ничего не пишем', async () => {
        const planned = state();
        const { w, products } = writer([state({ price: 5200 })]);
        const [res] = await w.applyPlans([planOzonPrice(planned, 5527, 7257)]);
        expect(products.setPrice).not.toHaveBeenCalled();
        expect(res).toMatchObject({ applied: false, stale: true, attempted: false });
    });

    it('отказ Ozon по цене — у своего товара, остальные прошли', async () => {
        const a = state({ offerId: '1', productId: 1, seller: null });
        const b = state({ offerId: '2', productId: 2, seller: null });
        const { w, products } = writer([a, b]);
        products.setPrice.mockResolvedValueOnce({
            result: [
                { offer_id: '1', updated: true },
                { offer_id: '2', updated: false, errors: [{ code: 'x', message: 'резкое изменение' }] },
            ],
        });
        const res = await w.applyPlans([planOzonPrice(a, 5527, 7257), planOzonPrice(b, 5527, 7257)]);
        expect(res.map((r) => r.applied)).toEqual([true, false]);
        expect(res[1].results[0]).toMatchObject({ status: 'rejected', reason: 'резкое изменение' });
    });
});

describe('чтение состояния', () => {
    const item = (offer_id: string, product_id: number) => ({
        offer_id,
        product_id,
        price: { price: '5110', min_price: '5110', old_price: '7257', marketing_seller_price: '5110' },
    });
    function service(isOn: boolean) {
        const products = {
            getPrices: jest.fn(async ({ offer_id }) => ({ items: offer_id.map((o, i) => item(o, i + 1)) })),
            listAllOfferIds: jest.fn(async () => ['a', 'b']),
        };
        const sellerApi = {
            currentAction: jest.fn(async () => ({ id: 9, title: '26-11', minPercent: 5, isOn })),
            listAll: jest.fn(async (kind: string) =>
                kind === 'list' ? [{ productId: 1, sku: 11, percent: 5, isActive: true }] : [],
            ),
        };
        return {
            svc: new PromoPriceService({} as any, sellerApi as any, products as any, {} as any),
            sellerApi,
            products,
        };
    }

    it('выключенная акция: процент в состоянии есть, покупатель по формуле — без скидки', async () => {
        const { svc } = service(false);
        const [a, b] = await svc.pricedStates();
        expect(a.seller).toMatchObject({ isActive: true, actionOn: false, percent: 5 });
        expect(a.buyerPriceCalc).toBe(5110);
        expect(b.seller).toBeNull();
    });

    it('список нашей акции читается раз в минуту; товар после нашей записи — заново', async () => {
        const { svc, sellerApi } = service(true);
        await svc.pricedStates(['a']);
        await svc.pricedStates(['a']);
        expect(sellerApi.currentAction).toHaveBeenCalledTimes(1);
        svc.forget([1]);
        await svc.pricedStates(['a']);
        expect(sellerApi.currentAction).toHaveBeenCalledTimes(2);
    });
});

describe('сторож — только вверх', () => {
    it('минимальная в Ozon ниже текущей цены — предельную не опускает (минимальная могла устареть)', () => {
        const s = state({ price: 681, minPrice: 209, oldPrice: 900, buyerPrice: 647, buyerPriceCalc: 647 });
        const plan = guardPlan(s);
        expect(plan.steps).toEqual([]);
        expect(plan.price).toBe(681);
    });

    it('покупатель ниже минимальной (акцию включили) — поднимает предельную', () => {
        const s = state({ price: 5110, minPrice: 5110, oldPrice: 7257, buyerPrice: 4854, buyerPriceCalc: 4854 });
        const plan = guardPlan(s);
        expect(plan.steps).toEqual([
            {
                kind: 'base',
                target: {
                    currency_code: 'RUB',
                    offer_id: '537572',
                    price: String(limitPrice(5110, 5)),
                    min_price: '5110',
                    old_price: '7257',
                },
            },
        ]);
    });

    it('процент выше минимального — только процент вниз, цену не трогает', () => {
        const s = state({
            price: 1500,
            minPrice: 1000,
            oldPrice: 2000,
            seller: seller({ percent: 55 }),
            buyerPrice: 675,
            buyerPriceCalc: 675,
        });
        const plan = guardPlan(s);
        expect(plan.steps).toEqual([
            { kind: 'base', target: expect.objectContaining({ price: String(limitPrice(1000, 55)) }) },
            { kind: 'percent', actionId: 9, sku: 1, from: 55, to: 5 },
        ]);
    });
});
