import { legacyActionPlan, LegacyPromoActionWriter } from './legacy-promo-action-writer';
import { PromoPriceState } from './price-lever/promo-price.types';

const state: PromoPriceState = {
    offerId: 'sku',
    productId: 10,
    oldPrice: 1400,
    price: 1200,
    minPrice: 600,
    buyerPrice: 855,
    buyerPriceCalc: 855,
    seller: { actionId: 5, percent: 5, minPercent: 5, sku: 20, title: 'Наша', isActive: true },
    ozonActions: [
        {
            actionId: 7,
            title: 'Бустинг',
            maxActionPrice: 1000,
            actionPrice: 900,
            participant: true,
            isVoucher: false,
            stock: 1,
            startsAt: null,
        },
    ],
};
const item = { productId: 10, actionPrice: 950, stock: 8 };
describe('LegacyPromoActionWriter', () => {
    it('сохраняет участие по требуемой цене, если позволяет лимит', () => {
        const plan = legacyActionPlan(state, 7, { ...item, mode: 'repair' });
        expect(plan.steps).toEqual([{ kind: 'ozon-set', actionId: 7, title: 'Бустинг', from: 900, to: 950, stock: 8 }]);
        expect(plan.buyerAfter).toBe(902);
    });
    it.each(['remove', 'repair'] as const)(
        'ставит однозначное снятие по явному требованию либо при превышении лимита',
        (mode) => {
            expect(legacyActionPlan(state, 7, { ...item, actionPrice: 1200, mode }).steps[0].kind).toBe('ozon-remove');
        },
    );
    it('промокод снимает напрямую и запрещает новое назначение цены', () => {
        const slot = { ...state.ozonActions[0], isVoucher: true };
        expect(legacyActionPlan({ ...state, ozonActions: [slot] }, 7, { ...item, mode: 'repair' }).steps[0].kind).toBe(
            'ozon-remove',
        );
        expect(() =>
            legacyActionPlan({ ...state, ozonActions: [{ ...slot, participant: false }] }, 7, { ...item, mode: 'add' }),
        ).toThrow('не допускают');
    });
    it('учитывает другие акции и фиксирует лимит и изменение участия после отбора', () => {
        const slots = [
            { ...state.ozonActions[0], participant: false },
            { ...state.ozonActions[0], actionId: 9, actionPrice: 700 },
        ];
        const s = { ...state, ozonActions: slots, buyerPrice: 665, buyerPriceCalc: 665 };
        expect(legacyActionPlan(s, 7, { ...item, mode: 'add' }).buyerAfter).toBe(665);
        expect(() => legacyActionPlan(s, 7, { ...item, mode: 'add', actionPrice: 1020 })).toThrow('не допускают');
        expect(() => legacyActionPlan(state, 7, { ...item, mode: 'add' })).toThrow('изменилось');
    });
    it('откладывает назначение до окна проверки, если цена акции вступит в силу позже', () => {
        const future = { ...state.ozonActions[0], participant: false, startsAt: '2026-11-21T09:00:00Z' };
        expect(() =>
            legacyActionPlan(
                { ...state, ozonActions: [future] },
                7,
                { ...item, mode: 'add' },
                new Date('2026-11-18T09:00:00Z'),
            ),
        ).toThrow('позже горизонта');
    });
    it('только подтверждённый переход попадает в успех, неполный снимок и отложенная запись получают причину', async () => {
        const priceRead = jest.fn().mockResolvedValue({ items: [{}] });
        const read = jest.fn().mockResolvedValue([state]);
        const applyPromos = jest
            .fn()
            .mockImplementation(async ([plan]) => [
                { ...plan, applied: false, verification: 'pending', notes: ['Ожидаем'] },
            ]);
        const writer = new LegacyPromoActionWriter(
            { getPrices: priceRead } as any,
            { statesForPrices: read } as any,
            { applyPromos } as any,
        );
        expect(
            await writer.apply(7, [
                { ...item, mode: 'repair' },
                { ...item, productId: 11, mode: 'repair' },
            ]),
        ).toEqual({
            added: [],
            removed: [],
            failed: [
                { productId: 11, reason: expect.stringMatching(/нет свежего/) },
                { productId: 10, reason: 'Ожидаем' },
            ],
        });
        expect(applyPromos).toHaveBeenCalledTimes(1);
    });
});
