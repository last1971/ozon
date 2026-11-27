import { buyerAfterSteps, planBaseUpdate, planPromoPrice, stepsToSend } from './promo-price.planner';
import { OzonActionSlot, PriceStep, PromoPriceState } from './promo-price.types';

const boost = (over: Partial<OzonActionSlot> = {}): OzonActionSlot => ({
    actionId: 1,
    title: 'Бустинг',
    isVoucher: false,
    unifiedPrice: true,
    participant: true,
    actionPrice: 259,
    maxActionPrice: 300,
    stock: 5,
    startsAt: null,
    ...over,
});

/** 537432 на магазине 27.11: покупатель 246 ₽ при минимальной 849 ₽, товар в бустингах, наш процент 5. */
const stuck = (over: Partial<PromoPriceState> = {}): PromoPriceState => ({
    offerId: '537432',
    productId: 779476120,
    price: 259,
    oldPrice: 1089,
    minPrice: 849,
    calcMinPrice: 849,
    buyerPrice: 246,
    buyerPriceCalc: 246,
    seller: { actionId: 9, title: '26-11', minPercent: 5, sku: 1, percent: 5, isActive: true },
    ozonActions: [boost(), boost({ actionId: 2, title: 'Супербустинг' })],
    ...over,
});

describe('модель цены покупателю после шагов', () => {
    it('без шагов — формула Ozon, выход из всех акций — база с нашим процентом', () => {
        const s = stuck({ price: 929, ozonActions: [boost(), boost({ actionId: 2 })] });
        expect(buyerAfterSteps(s, [])).toBe(246);
        const out: PriceStep[] = [1, 2].map((actionId) => ({ kind: 'ozon-remove', actionId, title: '', from: 259, reason: '' }));
        expect(buyerAfterSteps(s, out)).toBe(883);
        expect(buyerAfterSteps(s, [out[0]])).toBe(246);
    });

    it('цена бустинга общая: запись в один бустинг меняет её во всех', () => {
        const s = stuck({ price: 929 });
        expect(buyerAfterSteps(s, [{ kind: 'ozon-set', actionId: 1, title: '', from: 259, to: 900 }])).toBe(855);
    });
});

describe('одно направление цены за проход', () => {
    it('537432: проход 1 выводит из бустингов сразу, проход 2 опускает процентом к минимальной', () => {
        const s = stuck({ price: 929 });
        const first = stepsToSend(s, planPromoPrice(s, 'min').steps, 849);
        expect(first.send.map((step) => step.kind)).toEqual(['ozon-remove', 'ozon-remove']);
        expect(first.deferred).toEqual([{ kind: 'percent', actionId: 9, sku: 1, from: 5, to: 8 }]);
        expect(buyerAfterSteps(s, first.send)).toBe(883);

        const after = stuck({
            price: 929,
            buyerPrice: 883,
            buyerPriceCalc: 883,
            ozonActions: s.ozonActions.map((a) => ({ ...a, participant: false, actionPrice: 0 })),
        });
        const second = stepsToSend(after, planPromoPrice(after, 'min').steps, 849);
        expect(second).toEqual({ send: [{ kind: 'percent', actionId: 9, sku: 1, from: 5, to: 8 }], deferred: [] });
        expect(buyerAfterSteps(after, second.send)).toBe(855);
    });

    it('подъём и снижение вместе: сначала только подъём, снижение — следующим проходом', () => {
        const s = stuck({ price: 1000, seller: { ...stuck().seller, percent: 10 } });
        const raise: PriceStep = { kind: 'ozon-remove', actionId: 1, title: '', from: 259, reason: '' };
        const lower: PriceStep = { kind: 'percent', actionId: 9, sku: 1, from: 10, to: 15 };
        expect(stepsToSend(s, [raise, lower], 849)).toEqual({ send: [raise], deferred: [lower] });
    });

    it('снижение уходит, только если ни один частичный итог не ниже минимальной', () => {
        const s = stuck({ price: 1000, buyerPrice: 950, buyerPriceCalc: 950, ozonActions: [] });
        const safe: PriceStep = { kind: 'percent', actionId: 9, sku: 1, from: 5, to: 10 };
        expect(stepsToSend(s, [safe], 849)).toEqual({ send: [safe], deferred: [] });
        const deep: PriceStep = { kind: 'percent', actionId: 9, sku: 1, from: 5, to: 20 };
        expect(stepsToSend(s, [deep], 849)).toEqual({ send: [], deferred: [deep] });
    });

    it('формула не объясняет цену Ozon — снижать нельзя, поднимать можно', () => {
        const s = stuck({ price: 1000, buyerPrice: 900, buyerPriceCalc: 950, ozonActions: [] });
        const lower: PriceStep = { kind: 'percent', actionId: 9, sku: 1, from: 5, to: 10 };
        expect(stepsToSend(s, [lower], 849)).toEqual({ send: [], deferred: [lower] });
        const raise: PriceStep = { kind: 'percent', actionId: 9, sku: 1, from: 5, to: 0 };
        expect(stepsToSend(s, [raise], 849).send).toEqual([raise]);
    });
});

describe('новая база из пересчёта', () => {
    const row = { offer_id: '537432', currency_code: 'RUB', price: '929', min_price: '849', old_price: '1089' };

    it('база за ценой акции не меняет покупателю — повторно не импортируется', () => {
        const s = stuck({ minPrice: 849, oldPrice: 1089 });
        const { steps } = planBaseUpdate(s, row);
        expect(steps.some((step) => step.kind === 'base')).toBe(false);
        expect(steps.length).toBeGreaterThan(0);
    });

    it('изменились минимальная или зачёркнутая — база уходит, план считается от новой базы', () => {
        const s = stuck({ minPrice: 700, oldPrice: 1089 });
        const { steps, plan } = planBaseUpdate(s, row);
        expect(steps[0]).toMatchObject({ kind: 'base', target: { price: '929', min_price: '849' } });
        expect(plan.buyerAfter).toBeGreaterThanOrEqual(849);
    });
});
