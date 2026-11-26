import { buyerPrice } from '../../helpers/price/buyer.price.helper';
import { AutoAction, UpdatePriceDto } from '../../price/dto/update.price.dto';
import { PromoPriceApplier } from './promo-price.applier';
import { planPromoPrice } from './promo-price.planner';
import { PromoPriceState } from './promo-price.types';
import { OzonPriceTransitionService } from './ozon-price-transition.service';

function fixture(offer = '539124-5') {
    const target: UpdatePriceDto = {
        offer_id: offer,
        price: '822',
        old_price: '1030',
        min_price: '297',
        currency_code: 'RUB',
        ozonDeadZoneFloor: 718,
        auto_action_enabled: AutoAction.ENABLED,
    };
    const state: PromoPriceState = {
        offerId: offer,
        productId: 11,
        price: 808,
        oldPrice: 1012,
        minPrice: 294,
        buyerPrice: 299,
        buyerPriceCalc: 299,
        calcMinPrice: 297,
        deadZoneFloor: 718,
        calculationKey: 'economics',
        autoActionEnabled: true,
        seller: { actionId: 2, title: 'Скидка', minPercent: 5, percent: 63, sku: 11, isActive: true },
        ozonActions: [],
    };
    let serial = 0;
    let delayed = false;
    let afterWrite: (() => void) | undefined;
    const writes: string[] = [];
    const prices: number[] = [];
    const notices = [];
    const saved = new Map<string, any>();
    const versions = new Map<string, string>();
    const reserve = (offer: string, payload: any) => {
        const row = { token: String(++serial), payload: structuredClone(payload) };
        saved.set(offer, row);
        versions.set(offer, row.token);
        return row;
    };
    const journal = {
        versions: async () => new Map(versions),
        pending: async (offer: string) => saved.get(offer),
        outstanding: async () => new Map(saved),
        claim: async (offer: string, payload: any, _stream: unknown, version: string | null) =>
            saved.has(offer) || (versions.get(offer) ?? null) !== version ? null : reserve(offer, payload),
        advance: async (offer: string, token: string, payload: any) =>
            saved.get(offer)?.token === token ? reserve(offer, payload) : null,
        finish: async (offer: string, token: string, _stream: any, notice: any) => {
            if (saved.get(offer)?.token !== token) return false;
            if (notice) notices.push(notice);
            versions.set(offer, String(++serial));
            return saved.delete(offer);
        },
    };
    function apply(write: string, effect: () => void) {
        expect(saved.size).toBe(1);
        writes.push(write);
        const flush = () => {
            effect();
            const actions = state.ozonActions.filter((s) => s.participant).map((s) => s.actionPrice);
            state.buyerPrice = state.buyerPriceCalc = buyerPrice(state.price, actions, state.seller.percent);
            prices.push(state.buyerPrice);
        };
        if (delayed) afterWrite = flush;
        else flush();
    }
    const reader = { allStates: async () => [structuredClone(state)] };
    const products = {
        setPrice: jest.fn(async ({ prices: [row] }) => {
            apply('base', () =>
                Object.assign(state, {
                    price: Number(row.price),
                    minPrice: Number(row.min_price),
                    oldPrice: Number(row.old_price),
                }),
            );
            return { result: [{ offer_id: offer, updated: true }] };
        }),
    };
    const seller = {
        setPercent: jest.fn(async (_id, rows) => {
            apply('percent ' + rows[0].percent, () => {
                state.seller.percent = rows[0].percent;
            });
            return { applied: rows };
        }),
    };
    const ops = { update: jest.fn(), deactivate: jest.fn() };
    const create = () =>
        new OzonPriceTransitionService(
            { get: () => reader } as any,
            { enrichBatch: async () => new Map() } as any,
            journal as any,
            products as any,
            ops as any,
            seller as any,
        );
    return {
        state,
        target,
        apply,
        products,
        writes,
        prices,
        notices,
        create,
        saved,
        seller,
        ops,
        delay: () => {
            delayed = true;
        },
        deliver: () => {
            delayed = false;
            afterWrite?.();
            afterWrite = undefined;
        },
    };
}

// Five promotions from the 560166 incident. Model the visible Ozon price
// independently of the planner, including a promotion reset during a base import.
function lossFixture(reset: 'keep' | 'base' | 'floor' = 'keep') {
    const f = fixture('560166');
    const { state, target } = f;
    let base = 5415;
    Object.assign(target, { price: '5909', min_price: '5469', old_price: '6789', ozonDeadZoneFloor: 5469 });
    Object.assign(state, {
        price: 3931, confirmedBase: base, minPrice: 5012, oldPrice: 6222, buyerPrice: 3656, buyerPriceCalc: 3656,
        calcMinPrice: 5469, deadZoneFloor: 5469,
        seller: { ...state.seller, percent: 7 },
        ozonActions: [4115, 3931, 4318, 4294, 4466].map((cap, index) => ({
            actionId: index + 1, title: 'Акция ' + (index + 1), isVoucher: false, participant: true,
            actionPrice: 3931, maxActionPrice: cap, stock: 0,
        })),
    });
    const refresh = () => {
        const participants = state.ozonActions.filter(a => a.participant);
        state.price = Math.min(base, ...participants.map(a => a.actionPrice));
        state.buyerPrice = state.buyerPriceCalc = buyerPrice(state.price, [], state.seller.percent);
    };
    f.products.setPrice.mockImplementation(async ({ prices: [row] }) => {
        f.apply('base ' + row.min_price, () => {
            base = Number(row.price);
            state.minPrice = Number(row.min_price);
            state.oldPrice = Number(row.old_price);
            state.confirmedBase = base;
            for (const action of state.ozonActions.filter(a => a.participant)) {
                if (reset === 'floor') action.actionPrice = state.minPrice;
                if (reset === 'base') action.actionPrice = base;
            }
            refresh();
        });
        return { result: [{ offer_id: state.offerId, updated: true }] };
    });
    f.ops.update.mockImplementation(async (id, [row]) => {
        expect(row.actionPrice).toBe(5881);
        f.apply('remove ' + id, () => {
            state.ozonActions.find(a => a.actionId === id).participant = false;
            refresh();
        });
        return { added: [], unchanged: [], removed: [state.productId], rejected: [] };
    });
    return { ...f, refresh };
}

describe('Защита минимума по 560166', () => {
    it.each(['keep', 'base', 'floor'] as const)('подтверждает выход до снятия защиты, ответ %s', async reset => {
        const f = lossFixture(reset);
        expect((await f.create().updateBases([f.target]))[0].updated).toBe(true);
        expect(f.writes).toEqual(['remove 1', 'remove 2', 'remove 3', 'remove 4', 'base 5881', 'remove 5', 'base 5469']);
        expect(f.prices.every(price => price === 3656 || price >= 5469)).toBe(true);
        expect(f.state.buyerPrice).toBe(5495);
        expect((await f.create().updateBases([f.target]))[0].updated).toBe(true);
        expect(f.writes).toHaveLength(7);
    });
    it.each(['added', 'unchanged'])('сохраняет ответ %s между запусками и продолжает после подтверждения выхода', async reply => {
        const f = lossFixture();
        f.ops.update.mockImplementationOnce(async (id, [row]) => {
            f.apply('kept', () => {
                f.state.ozonActions.find(a => a.actionId === id).actionPrice = row.actionPrice;
                f.refresh();
            });
            return { added: [], removed: [], rejected: [], unchanged: [], [reply]: [f.state.productId] };
        });
        for (let i = 0; i < 2; i++) {
            const [result] = await f.create().updateBases([f.target]);
            expect(result.transition).toBe('blocked');
            expect(result.errors[0].message).toMatch(/560166.*3656.*5469.*Акция 1.*Повтор/);
            await f.create().resume();
        }
        expect(f.ops.update).toHaveBeenCalledTimes(1);
        f.state.ozonActions[0].participant = false;
        f.refresh();
        await f.create().resume();
        expect(f.saved.size).toBe(0);
        expect(f.state.buyerPrice).toBe(5495);
    });
    it('закрывает подтверждённый выход, если Ozon одновременно изменил другие акции, и заново считает цель', async () => {
        const f = lossFixture();
        f.ops.update.mockImplementationOnce(async () => {
            f.apply('external group removal', () => {
                f.state.ozonActions.forEach(a => a.participant = false);
                f.refresh();
            });
            return { added: [], removed: [f.state.productId], unchanged: [], rejected: [] };
        });
        const [first] = await f.create().updateBases([f.target]);
        expect(first).toMatchObject({ transition: 'pending', updated: false, observedBuyerPrice: 5036 });
        expect(f.saved.size).toBe(0);
        expect(f.ops.update).toHaveBeenCalledTimes(1);
        expect((await f.create().updateBases([f.target]))[0]).toMatchObject({ updated: true, observedBuyerPrice: 5495 });
        expect(f.ops.update).toHaveBeenCalledTimes(1);
    });

    it('ждёт запоздалого подтверждения без второй отправки', async () => {
        const f = lossFixture();
        f.delay();
        const [result] = await f.create().updateBases([f.target]);
        expect(result.transition).toBe('pending');
        expect(result.errors[0].message).toMatch(/560166.*3656.*5469/);
        await f.create().resume();
        expect(f.ops.update).toHaveBeenCalledTimes(1);
        f.deliver();
        await f.create().resume();
        expect(f.state.buyerPrice).toBe(5495);
    });
});

describe('Ozon price writer with real planner and independent readback', () => {
    it('changes 539124-5 only through profitable states and a repeated import does not write', async () => {
        const f = fixture();
        for (let i = 0; i < 2; i++) expect((await f.create().updateBases([f.target]))[0].updated).toBe(true);
        expect(f.writes).toEqual(['percent 11', 'base', 'percent 12']);
        expect(f.prices).toEqual([719, 732, 723]);
        expect(f.notices).toHaveLength(1);
        expect(f.notices[0]).toMatchObject({ buyerBefore: 299, observedBuyerPrice: 723, verification: 'confirmed' });
    });
    it('two callers and a restart wait for the existing request before continuing', async () => {
        const f = fixture();
        f.delay();
        const results = await Promise.all([f.create().updateBases([f.target]), f.create().updateBases([f.target])]);
        expect(results.map((r) => r[0].errors[0].code)).toEqual(['transition_pending', 'transition_pending']);
        await f.create().resume();
        expect(f.writes).toEqual(['percent 11']);
        f.deliver();
        await f.create().resume();
        expect(f.prices).toEqual([719, 732, 723]);
        expect(f.notices).toHaveLength(1);
        expect(f.saved.size).toBe(0);
    });
    it('stops before a second write if costs have changed during the delay', async () => {
        const f = fixture();
        f.delay();
        await f.create().updateBases([f.target]);
        f.deliver();
        f.state.calculationKey = 'new cost';
        await f.create().resume();
        expect(f.writes).toEqual(['percent 11']);
        expect(f.notices).toHaveLength(0);
    });
    it('uses the same lock for manual promotion and base writes', async () => {
        const f = fixture();
        f.delay();
        await f.create().updateBases([f.target]);
        const manual = planPromoPrice(f.state, 'normal');
        const r = await new PromoPriceApplier(f.create()).apply(manual);
        expect(r.verification).toBe('pending');
        expect(f.writes).toEqual(['percent 11']);
    });
    it('cannot send the next step after a timeout, even on restart', async () => {
        const f = fixture();
        f.seller.setPercent.mockRejectedValueOnce(new Error('timeout'));
        expect((await f.create().updateBases([f.target]))[0].errors[0].code).toBe('transition_pending');
        await f.create().resume();
        expect(f.seller.setPercent).toHaveBeenCalledTimes(1);
        expect(f.writes).toEqual([]);
    });
    it('waits for a new plan after a definite refusal', async () => {
        const f = fixture();
        f.seller.setPercent.mockResolvedValueOnce({
            applied: [],
            rejected: [{ sku: 11, reason: 'discount rejected' }],
        } as any);
        expect((await f.create().updateBases([f.target]))[0]).toMatchObject({
            updated: false,
            errors: [{ code: 'transition_blocked', message: 'discount rejected' }],
        });
        expect(f.saved.size).toBe(0);
    });
    it('rejects unmodelled changes in Ozon auto-enrollment before touching the discount', async () => {
        const f = fixture();
        f.state.autoActionEnabled = false;
        expect((await f.create().updateBases([f.target]))[0].updated).toBe(false);
        expect(f.writes).toEqual([]);
    });
});
