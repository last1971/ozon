import { buyerPrice } from '../../helpers/price/buyer.price.helper';
import { AutoAction, UpdatePriceDto } from '../../price/dto/update.price.dto';
import { PromoPriceApplier } from './promo-price.applier';
import { planPromoPrice } from './promo-price.planner';
import { PromoPriceState } from './promo-price.types';
import { OzonPriceTransitionService } from './ozon-price-transition.service';

function fixture() {
    const offer = '539124-5';
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
            { enrichBatch: async () => undefined } as any,
            journal as any,
            products as any,
            ops as any,
            seller as any,
        );
    return {
        state,
        target,
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
