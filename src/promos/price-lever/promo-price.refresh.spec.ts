import { planPromoPrice } from './promo-price.planner';
import { refreshPromoPlan } from './promo-price.refresh';
import { PromoPriceState } from './promo-price.types';

const state = (over: Partial<PromoPriceState> = {}): PromoPriceState => ({
    offerId: '563893',
    productId: 77,
    oldPrice: 1500,
    price: 1400,
    minPrice: 1100,
    calcMinPrice: 1100,
    buyerPrice: 900,
    buyerPriceCalc: 900,
    seller: null,
    ozonActions: [
        {
            actionId: 1977747,
            title: 'Бустинг',
            isVoucher: false,
            participant: true,
            actionPrice: 900,
            maxActionPrice: 1155,
            stock: 2,
            startsAt: null,
        },
    ],
    ...over,
});
const api = (maxActionPrice: number, overrides = {}) => ({
    currentProduct: jest.fn().mockResolvedValue({
        id: 77,
        price: 1400,
        actionPrice: 900,
        maxActionPrice,
        stock: 3,
        minStock: 0,
        participant: true,
        ...overrides,
    }),
});

describe('Свежие условия Ozon перед применением', () => {
    it('1155 → 1150: использует свежий лимит и тот же планировщик', async () => {
        const original = planPromoPrice(state(), 'normal');
        const result = await refreshPromoPlan(original, api(1150));
        expect(result.steps).toContainEqual(expect.objectContaining({ kind: 'ozon-set', to: 1150 }));
        expect(result.buyerAfter).toBeGreaterThanOrEqual(1100);
        expect(result.state.ozonActions[0].stock).toBe(3);
        expect(original.state.ozonActions[0].maxActionPrice).toBe(1155);
    });
    it('лимит ниже прибыли — снятие участника, не снижение до убыточной цены', async () => {
        const result = await refreshPromoPlan(planPromoPrice(state(), 'min'), api(1099));
        expect(result.steps).toContainEqual(expect.objectContaining({ kind: 'ozon-remove' }));
        expect(result.steps.some((s) => s.kind === 'ozon-set')).toBe(false);
    });
    it('кандидата не добавляет при лимите ниже пола', async () => {
        const s = state();
        s.ozonActions[0].participant = false;
        const result = await refreshPromoPlan(
            planPromoPrice(s, 'min'),
            api(1099, { participant: false, actionPrice: 0 }),
        );
        expect(result.steps).toEqual([]);
    });
    it('сохраняет расчётный минимум, мёртвую зону и наложенную скидку продавца', async () => {
        const s = state({
            minPrice: 150,
            calcMinPrice: 170,
            deadZoneFloor: 500,
            seller: { actionId: 8, title: 'Наша', sku: 9, minPercent: 5, percent: 5, isActive: true },
        });
        const result = await refreshPromoPlan(planPromoPrice(s, 600, 5), api(530));
        expect(result.ok).toBe(true);
        expect(result.buyerAfter).toBeGreaterThanOrEqual(500);
        expect(result.state.calcMinPrice).toBe(170);
    });
    it('не отправляет цену в мёртвой зоне после снижения лимита акции', async () => {
        const s = state({ minPrice: 170, calcMinPrice: 170, deadZoneFloor: 500 });
        await expect(refreshPromoPlan(planPromoPrice(s, 600), api(400))).rejects.toThrow('минимальную прибыль');
    });
    it('не применяет план при ошибке чтения или исчезновении товара', async () => {
        const original = planPromoPrice(state(), 'min');
        await expect(
            refreshPromoPlan(original, { currentProduct: jest.fn().mockRejectedValue(new Error('429')) }),
        ).rejects.toThrow('429');
        await expect(refreshPromoPlan(original, { currentProduct: jest.fn().mockResolvedValue(null) })).rejects.toThrow(
            'отсутствует',
        );
        await expect(refreshPromoPlan(original, api(NaN))).rejects.toThrow('допустимой');
    });
    it('не загружает список для снятия и пустого плана', async () => {
        const source = api(0);
        const s = state();
        s.ozonActions[0].maxActionPrice = 1000;
        await refreshPromoPlan(planPromoPrice(s, 'min'), source);
        expect(source.currentProduct).not.toHaveBeenCalled();
    });
});
