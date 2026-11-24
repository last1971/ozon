import { planPromoPrice } from './promo-price.planner';
import { observedOzonBase, planOzonPriceTransition, transitionStepConfirmed } from './ozon-price-transition';
import { OzonActionSlot, PromoPriceState } from './promo-price.types';

const now = new Date('2026-11-18T10:24:19Z');
const slot = (id: number, price: number, maxActionPrice: number, startsAt: string = null): OzonActionSlot => ({
    actionId: id,
    title: String(id),
    isVoucher: false,
    participant: price > 0,
    actionPrice: price,
    maxActionPrice,
    stock: 0,
    startsAt,
});

function state(over: Partial<PromoPriceState> = {}): PromoPriceState {
    return {
        offerId: '539124-5',
        productId: 1,
        oldPrice: 1012,
        price: 808,
        minPrice: 294,
        calcMinPrice: 297,
        deadZoneFloor: 718,
        buyerPrice: 299,
        buyerPriceCalc: 299,
        seller: { sku: 1, actionId: 2, title: 'Наша', percent: 63, minPercent: 5, isActive: true },
        ozonActions: [],
        ...over,
    };
}

const goal = (s: PromoPriceState, price: number, minimum: number, old: number) => ({
    offer_id: s.offerId,
    price: String(price),
    min_price: String(minimum),
    old_price: String(old),
    currency_code: 'RUB',
});

describe('Переход между ценами и скидками Ozon', () => {
    it('539124-5: ни импорт первым, ни конечная скидка первой не безопасны', () => {
        const s = state();
        const target = goal(s, 822, 297, 1030);
        const result = planOzonPriceTransition(s, target, now);
        expect(result.ok).toBe(true);
        expect(result.steps.map((st) => [st.change.kind, st.buyerPrices])).toEqual([
            ['percent', [719]],
            ['base', [732]],
            ['percent', [723]],
        ]);
        const bridge = { ...s, buyerPrice: 719, buyerPriceCalc: 719, seller: { ...s.seller, percent: 11 } };
        expect(transitionStepConfirmed(s, result.steps[0], now)).toBe(false);
        expect(transitionStepConfirmed(bridge, result.steps[0], now)).toBe(true);
        expect(planOzonPriceTransition(bridge, target, now).steps.map((st) => st.change.kind)).toEqual([
            'base',
            'percent',
        ]);
        expect(transitionStepConfirmed({ ...bridge, buyerPriceCalc: 711 }, result.steps[0], now)).toBe(false);
    });

    it('563967-4: первый шаг сразу поднимает убыточные 302 ₽ до 638 ₽', () => {
        const s = state({
            offerId: '563967-4',
            price: 672,
            minPrice: 298,
            calcMinPrice: 635,
            deadZoneFloor: 635,
            buyerPrice: 302,
            buyerPriceCalc: 302,
            seller: { ...state().seller, percent: 55 },
        });
        const result = planOzonPriceTransition(s, goal(s, 681, 635, 772), now);
        expect(result.steps.map((st) => [st.change.kind, st.buyerPrices])).toEqual([
            ['percent', [638]],
            ['base', [647]],
            ['percent', [640]],
        ]);
    });

    it('355164-1: сохраняет целью все пять связанных акций при независимом сбросе цен во время импорта', () => {
        const s = state({
            offerId: '355164-1',
            price: 155,
            oldPrice: 208,
            minPrice: 147,
            calcMinPrice: 148,
            deadZoneFloor: 417,
            buyerPrice: 147,
            buyerPriceCalc: 147,
            seller: { ...state().seller, percent: 5 },
            ozonActions: [228, 197, 187, 205, 215].map((cap, i) => slot(i + 10, 155, cap)),
        });
        const target = goal(s, 169, 148, 208);
        const r = planOzonPriceTransition(s, target, now);
        expect(r.ok).toBe(true);
        expect(r.steps[0].change.kind).toBe('base');
        expect(r.steps[0].buyerPrices.sort()).toEqual([147, 161]);
        expect(r.steps.at(-1).buyerPrices).toEqual([148]);
        const after = {
            ...s,
            minPrice: 148,
            ozonActions: s.ozonActions.map((a, i) => (i ? a : { ...a, actionPrice: 169 })),
        };
        expect(transitionStepConfirmed(s, r.steps[0], now)).toBe(false);
        expect(transitionStepConfirmed(after, r.steps[0], now)).toBe(true);
        expect(planOzonPriceTransition(after, target, now, 169).steps.map((st) => st.change.kind)).toEqual(
            Array(5).fill('ozon-set'),
        );
        const final = {
            ...after,
            price: 156,
            buyerPrice: 148,
            buyerPriceCalc: 148,
            ozonActions: after.ozonActions.map((a) => ({ ...a, actionPrice: 156 })),
        };
        expect(observedOzonBase(final, now)).toBeUndefined();
        expect(planOzonPriceTransition(final, target, now, 169).steps).toEqual([]);
        // Identical promo prices alone are compatible with a different underlying normal.
        expect(planOzonPriceTransition(final, target, now).steps.length).toBeGreaterThan(0);
    });

    it('отказывается снять последнюю скрывающую акцию, если реальная база может попасть между тарифами', () => {
        const s = state({
            price: 299,
            minPrice: 290,
            calcMinPrice: 290,
            deadZoneFloor: 400,
            seller: null,
            buyerPrice: 299,
            buyerPriceCalc: 299,
            ozonActions: [slot(5, 299, 200)],
        });
        const plan = planPromoPrice(s, 'min', undefined, now);
        expect(plan.steps[0].kind).toBe('ozon-remove');
        expect(planOzonPriceTransition(s, plan, now)).toMatchObject({
            ok: false,
            steps: [],
            reason: expect.stringMatching(/Исключение из акции «5».*301 ₽.*300 и 400 ₽/),
        });
        expect(planOzonPriceTransition(s, plan, now, 299).ok).toBe(true);
    });

    it('учитывает раздельное применение сбросов даже когда обе крайние цены безопасны', () => {
        // 299 / 330 / 500 are all possible if only the cheapest action is reset.
        const s = state({
            price: 510,
            oldPrice: 600,
            minPrice: 290,
            calcMinPrice: 290,
            deadZoneFloor: 400,
            seller: null,
            buyerPrice: 299,
            buyerPriceCalc: 299,
            ozonActions: [slot(1, 299, 350), slot(2, 330, 350)],
        });
        const r = planOzonPriceTransition(s, goal(s, 500, 290, 650), now);
        expect(r.ok).toBe(true);
        expect(r.steps[0].change.kind).toBe('ozon-set');
        expect(r.steps.every((st) => st.buyerPrices.every((p) => p <= 300 || p >= 400))).toBe(true);
    });

    it('не выполняет план, если Ozon может исключить участника вместо изменения его цены и открыть убыток', () => {
        const s = state({
            price: 330,
            minPrice: 290,
            calcMinPrice: 290,
            deadZoneFloor: 400,
            seller: null,
            buyerPrice: 295,
            buyerPriceCalc: 295,
            ozonActions: [slot(1, 295, 350)],
        });
        const plan = planPromoPrice(s, 'min', undefined, now);
        expect(plan.ok).toBe(true);
        expect(planOzonPriceTransition(s, plan, now)).toMatchObject({
            ok: false,
            steps: [],
            reason: expect.stringMatching(/цены 290 ₽ в акции «1».*если Ozon исключит товар.*330 ₽.*300 и 400 ₽/),
        });
    });

    it('устанавливает временный защитный минимум, проверяет его и возвращает запрошенный минимум', () => {
        // At 123 ₽ a blind deactivation of the last slot could expose the unknown tariff at 301 ₽.
        const s = state({
            offerId: '376146-2',
            price: 130,
            minPrice: 122,
            oldPrice: 185,
            calcMinPrice: 122,
            deadZoneFloor: 347,
            buyerPrice: 123,
            buyerPriceCalc: 123,
            seller: { ...state().seller, percent: 5 },
            ozonActions: [slot(2, 130, 174)],
        });
        const target = goal(s, 143, 122, 185);
        const first = planOzonPriceTransition(s, target, now).steps[0];
        expect(first.change).toMatchObject({ kind: 'base', target: { ...target, min_price: '129' } });
        expect(transitionStepConfirmed(s, first, now)).toBe(false);
        const guarded = { ...s, minPrice: 129 };
        expect(transitionStepConfirmed(guarded, first, now)).toBe(true);
        const restore = planOzonPriceTransition(guarded, target, now, 143).steps[0];
        expect(restore.change).toMatchObject({ kind: 'base', target });
        expect(transitionStepConfirmed(guarded, restore, now)).toBe(false);
        expect(transitionStepConfirmed(s, restore, now)).toBe(true);
        expect(planOzonPriceTransition(s, target, now, 143).steps[0].change).toMatchObject({
            kind: 'ozon-set',
            to: 129,
        });
    });

    it('поднимает цену одной акции для прямого чтения normal до возвращения желаемой скидки', () => {
        const s = state({
            price: 866,
            minPrice: 823,
            oldPrice: 1200,
            calcMinPrice: 823,
            deadZoneFloor: 823,
            buyerPrice: 823,
            buyerPriceCalc: 823,
            seller: { ...state().seller, percent: 5 },
            ozonActions: [slot(2, 866, 982)],
        });
        const target = goal(s, 928, 823, 1200);
        const path = planOzonPriceTransition(s, target, now);
        expect(path.steps.some((st) => st.change.kind === 'ozon-set' && st.change.to > 928)).toBe(true);
        expect(observedOzonBase(s, now)).toBeUndefined();
        const lifted = { ...s, price: 928, buyerPrice: 882, buyerPriceCalc: 882, ozonActions: [slot(2, 929, 982)] };
        expect(observedOzonBase(lifted, now)).toBe(928);
        expect(planOzonPriceTransition(lifted, target, now).steps.map((st) => st.change.kind)).toEqual(['ozon-set']);
        // If Ozon exposes a different normal instead, the requested regular price is imported before remasking.
        const different = { ...lifted, price: 866, buyerPrice: 823, buyerPriceCalc: 823 };
        expect(observedOzonBase(different, now)).toBe(866);
        expect(planOzonPriceTransition(different, target, now).steps[0].change.kind).toBe('base');
    });

    it('при будущей акции проверяет цену в момент отправки и после начала акции', () => {
        const s = state({
            seller: null,
            price: 800,
            minPrice: 295,
            calcMinPrice: 295,
            deadZoneFloor: 600,
            buyerPrice: 800,
            buyerPriceCalc: 800,
            ozonActions: [slot(8, 0, 340, '2026-11-18T10:55:00Z')],
        });
        const plan = planPromoPrice(s, 'min', undefined, now);
        expect(planOzonPriceTransition(s, plan, now).steps[0].buyerPrices.sort()).toEqual([295, 800]);
    });

    it('сверяет новый лимит акции и идентификатор акции продавца перед повтором фиксированного плана', () => {
        const s = state({
            price: 100,
            minPrice: 80,
            calcMinPrice: 80,
            deadZoneFloor: undefined,
            seller: { ...state().seller, percent: 5 },
            ozonActions: [slot(11, 90, 100)],
            buyerPrice: 85,
            buyerPriceCalc: 85,
        });
        const p = planPromoPrice(s, 'min', undefined, now);
        expect(p.steps[0].kind).toBe('ozon-set');
        expect(planOzonPriceTransition({ ...s, ozonActions: [slot(11, 90, 82)] }, p, now).ok).toBe(false);
        const current = state();
        const explicit = planPromoPrice(current, 'normal', 5, now);
        expect(explicit.steps[0].kind).toBe('percent');
        expect(
            planOzonPriceTransition({ ...current, seller: { ...current.seller, actionId: 500 } }, explicit, now).ok,
        ).toBe(false);
    });

    it('не принимает посторонний товар или цену с неизвестным источником скидки', () => {
        const s = state();
        expect(planOzonPriceTransition(s, { ...goal(s, 822, 297, 1030), offer_id: 'другой' }, now).ok).toBe(false);
        expect(planOzonPriceTransition({ ...s, buyerPrice: 1 }, goal(s, 822, 297, 1030), now).ok).toBe(false);
    });
});
