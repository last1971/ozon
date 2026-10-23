import { planPromoPrice, targetRubles } from './promo-price.planner';
import { OzonActionSlot, PromoPriceState, SellerSlot } from './promo-price.types';

describe('planPromoPrice — план цены через акции (без вызовов API)', () => {
    const seller = (over: Partial<SellerSlot> = {}): SellerSlot => ({
        actionId: 4376619,
        title: '26-10',
        minPercent: 5,
        sku: 2360940454,
        percent: 5,
        isActive: true,
        ...over,
    });
    const elastic = (over: Partial<OzonActionSlot> = {}): OzonActionSlot => ({
        actionId: 1977747,
        title: 'Эластичный бустинг',
        isVoucher: false,
        participant: true,
        actionPrice: 226,
        maxActionPrice: 245,
        stock: 0,
        startsAt: null,
        ...over,
    });
    /** 383367 живьём 19.10: 321/255/213, эластичный 226 (лимит 245), наши 5 % → 215. */
    const state = (over: Partial<PromoPriceState> = {}): PromoPriceState => ({
        offerId: '383367',
        productId: 2065673718,
        oldPrice: 321,
        price: 255,
        minPrice: 213,
        buyerPrice: 215,
        buyerPriceCalc: 215,
        seller: seller(),
        ozonActions: [elastic()],
        ...over,
    });

    it('383367 «нормальная»: Ozon-акцию поднять до лимита 245, процент 5 остаётся → 233', () => {
        const plan = planPromoPrice(state(), 'normal');
        expect(plan.floor).toBe(225);
        expect(plan.steps).toEqual([
            { kind: 'ozon-set', actionId: 1977747, title: 'Эластичный бустинг', from: 226, to: 245 },
        ]);
        expect(plan.buyerAfter).toBe(233);
        expect(plan.ok).toBe(true);
        expect(plan.notes.join()).toContain('лимит 245');
    });

    it('383367 «минимальная»: цена акции = пол 225 → покупателю 214 ≥ 213', () => {
        const plan = planPromoPrice(state(), 'min');
        expect(plan.steps).toEqual([
            { kind: 'ozon-set', actionId: 1977747, title: 'Эластичный бустинг', from: 226, to: 225 },
        ]);
        expect(plan.buyerAfter).toBe(214);
        expect(plan.ok).toBe(true);
    });

    it('Ozon-акция стоит на дне (528757: 254/211, лимит 211): выкинуть и держать ценой нашим процентом', () => {
        const plan = planPromoPrice(
            state({
                price: 254,
                minPrice: 211,
                buyerPrice: 200,
                ozonActions: [elastic({ actionPrice: 211, maxActionPrice: 211 })],
            }),
            'min',
        );
        expect(plan.steps).toEqual([
            {
                kind: 'ozon-remove',
                actionId: 1977747,
                title: 'Эластичный бустинг',
                from: 211,
                reason: 'лимит 211 < пол 223',
            },
            { kind: 'percent', actionId: 4376619, sku: 2360940454, from: 5, to: 16 },
        ]);
        expect(plan.buyerAfter).toBe(213);
        expect(plan.ok).toBe(true);
        expect(plan.floor).toBe(223); // пол решения по Ozon-акции, не пересчитанный от 16 %
    });

    it('без Ozon-акций своя цена: процент под цель от price, не ниже минимума акции', () => {
        const plan = planPromoPrice(state({ ozonActions: [] }), 240);
        expect(plan.steps).toEqual([{ kind: 'percent', actionId: 4376619, sku: 2360940454, from: 5, to: 6 }]);
        expect(plan.buyerAfter).toBe(240);
        expect(planPromoPrice(state({ ozonActions: [] }), 'normal').percent).toBe(5); // минимум 5, не 0
    });

    it('кандидат нашей акции при подходящей Ozon-акции в нашу не добавляется — процент 0, пол = min_price', () => {
        const plan = planPromoPrice(state({ seller: seller({ isActive: false, percent: 5 }) }), 'min');
        expect(plan.percent).toBe(0);
        expect(plan.floor).toBe(213);
        expect(plan.steps).toEqual([
            { kind: 'ozon-set', actionId: 1977747, title: 'Эластичный бустинг', from: 226, to: 213 },
        ]);
        expect(plan.buyerAfter).toBe(213);
    });

    it('кандидат нашей акции без подходящих Ozon-акций — добавляется в нашу (from: null)', () => {
        const plan = planPromoPrice(
            state({
                seller: seller({ isActive: false }),
                ozonActions: [elastic({ participant: false, actionPrice: 0, maxActionPrice: 200 })],
            }),
            'normal',
        );
        expect(plan.steps).toEqual([{ kind: 'percent', actionId: 4376619, sku: 2360940454, from: null, to: 5 }]);
        expect(plan.notes.join()).toContain('не добавляем');
        expect(plan.buyerAfter).toBe(242);
    });

    it('кандидат Ozon-акции с подходящим лимитом добавляется (from: null)', () => {
        const plan = planPromoPrice(state({ ozonActions: [elastic({ participant: false, actionPrice: 0 })] }), 'min');
        expect(plan.steps[0]).toEqual({
            kind: 'ozon-set',
            actionId: 1977747,
            title: 'Эластичный бустинг',
            from: null,
            to: 225,
        });
    });

    it('нелечимо: даже минимальный процент уводит ниже дна → ok:false и причина', () => {
        const plan = planPromoPrice(state({ price: 100, minPrice: 99, ozonActions: [] }), 'min');
        expect(plan.ok).toBe(false);
        expect(plan.percent).toBe(5);
        expect(plan.notes.join()).toContain('ниже дна');
    });

    it('ни Ozon-акций, ни нашей — шагов нет, цена = price', () => {
        const plan = planPromoPrice(state({ seller: null, ozonActions: [] }), 'min', 10);
        expect(plan.steps).toEqual([]);
        expect(plan.buyerAfter).toBe(255);
        expect(plan.closest).toBe(false);
        expect(plan.notes.join()).toContain('процент не назначить');
    });

    /** 542774 живьём 23.10: норм 2557, мин 1714, наш 32 % → 1739; 33 % дало бы 1713 — ниже минимальной. */
    it('«к минимальной»: цена выше цели меньше чем на шаг процента — шагов нет, ближе нельзя', () => {
        const s = state({
            offerId: '542774',
            price: 2557,
            minPrice: 1714,
            buyerPrice: 1739,
            buyerPriceCalc: 1739,
            seller: seller({ percent: 32 }),
            ozonActions: [],
        });
        const plan = planPromoPrice(s, 'min');
        expect(plan.steps).toEqual([]);
        expect(plan.buyerAfter).toBe(1739);
        expect(plan.closest).toBe(true);
    });

    /** 569106 живьём 23.10: норм 186, мин 160, наш 13 % → 161,82 (покупателю 162); 14 % → 159,96 — ниже минимальной. */
    it('«ближе нельзя» по точной цене следующего шага, не по округлённой', () => {
        const s = state({ offerId: '569106', price: 186, minPrice: 160, buyerPrice: 162, seller: seller({ percent: 13 }), ozonActions: [] });
        const plan = planPromoPrice(s, 'min');
        expect(plan.steps).toEqual([]);
        expect(plan.buyerAfter).toBe(162);
        expect(plan.closest).toBe(true);
    });

    describe('акция Ozon, которая ещё не началась (513498 живьём 23.10: Супербустинг 1598 только 30.10)', () => {
        const superboost = elastic({
            actionId: 4420432,
            title: 'Супербустинг с дополнительными баллами за скидки',
            actionPrice: 1598,
            maxActionPrice: 1941,
            startsAt: '2026-10-29T21:00:00Z',
        });
        const s513498 = state({
            offerId: '513498',
            price: 2174,
            minPrice: 1518,
            buyerPrice: 2065,
            seller: seller({ percent: 5 }),
            ozonActions: [superboost],
        });

        it('до старта больше часа — не учитываем: минимальную держит наш процент 5 → 30', () => {
            const plan = planPromoPrice(s513498, 'min', undefined, new Date('2026-10-23T09:00:00Z'));
            expect(plan.steps).toEqual([expect.objectContaining({ kind: 'percent', from: 5, to: 30 })]);
            expect(plan.buyerAfter).toBe(1522);
            expect(plan.notes.join()).toContain('начнётся 30.10');
        });

        it('за час до старта — учитываем как идущую: процент обратно к минимуму акции, цена в акции по полу', () => {
            const plan = planPromoPrice(
                { ...s513498, seller: seller({ percent: 30 }) },
                'min',
                undefined,
                new Date('2026-10-29T20:00:00Z'),
            );
            expect(plan.steps).toEqual([expect.objectContaining({ kind: 'percent', from: 30, to: 5 })]);
            expect(plan.buyerAfter).toBe(1518);
        });
    });

    it('цена выше цели больше чем на шаг процента — есть шаг, не «ближе нельзя»', () => {
        const s = state({ price: 2557, minPrice: 1714, buyerPrice: 1790, seller: seller({ percent: 30 }), ozonActions: [] });
        const plan = planPromoPrice(s, 'min');
        expect(plan.steps).toEqual([expect.objectContaining({ kind: 'percent', from: 30, to: 32 })]);
        expect(plan.closest).toBe(false);
    });

    it('цель вне коридора зажимается с пометкой; процент ниже минимума акции поднимается', () => {
        const plan = planPromoPrice(state({ ozonActions: [] }), 100, 2);
        expect(plan.target).toBe(213);
        expect(plan.notes.join()).toContain('вне коридора');
        expect(plan.notes.join()).toContain('ниже минимума акции');
    });

    it('промокодная акция: цену не трогаем, участник ниже пола выкидывается, дальше держит наш процент', () => {
        const voucher = elastic({
            actionId: 9,
            title: 'Промокод',
            isVoucher: true,
            actionPrice: 220,
            maxActionPrice: 0,
        });
        const plan = planPromoPrice(state({ ozonActions: [voucher] }), 'min');
        expect(plan.steps).toEqual([
            {
                kind: 'ozon-remove',
                actionId: 9,
                title: 'Промокод',
                from: 220,
                reason: 'промокодная, цена 220 < пол 225',
            },
            { kind: 'percent', actionId: 4376619, sku: 2360940454, from: 5, to: 16 },
        ]);
        expect(plan.buyerAfter).toBe(214);
        // промокодная выше пола — остаётся как есть, шагов по ней нет
        expect(planPromoPrice(state({ ozonActions: [{ ...voucher, actionPrice: 240 }] }), 'min').steps).toEqual([]);
    });

    it('targetRubles: кривая цель — ошибка', () => {
        expect(() => targetRubles(state(), 'abc' as any)).toThrow('abc');
    });
});
