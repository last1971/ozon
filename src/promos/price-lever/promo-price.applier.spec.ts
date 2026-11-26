import { buyerPrice } from '../../helpers/price/buyer.price.helper';
import { priceUpdateQueue } from '../../helpers/price/price-update.queue';
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
        reserve,
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
    const remove = (id: number) => {
        f.apply('remove ' + id, () => {
            state.ozonActions.find(a => a.actionId === id).participant = false;
            refresh();
        });
    };
    f.ops.deactivate.mockImplementation(async (id, products) => {
        expect(products).toEqual([state.productId]);
        remove(id);
        return products;
    });
    f.ops.update.mockImplementation(async (id, [row]) => {
        expect(row.actionPrice).toBe(5881);
        remove(id);
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
        expect(f.ops.deactivate).not.toHaveBeenCalled();
    });
    it('после явного выхода ждёт чтения Ozon и не дублирует запрос при перезапуске', async () => {
        const f = lossFixture('floor');
        const update = f.ops.update.getMockImplementation();
        f.ops.update.mockImplementation(async (id, rows) => {
            if (id === 5) throw new Error('timeout');
            return update(id, rows);
        });
        const [answer] = await f.create().updateBases([f.target]);
        expect(answer.transition).toBe('pending');
        await f.create().resume();
        expect(f.ops.update.mock.calls.filter(([id]) => id === 5)).toHaveLength(1);
        expect(f.ops.deactivate).not.toHaveBeenCalled();
        f.state.ozonActions[4].participant = false;
        f.refresh();
        await f.create().resume();
        expect(f.state.buyerPrice).toBe(5495);
        expect(f.saved.size).toBe(0);
    });
    it('возвращает причину отказа обновления бустинга', async () => {
        const f = lossFixture();
        f.ops.update.mockResolvedValue({ added: [], removed: [], unchanged: [],
            rejected: [{ productId: f.state.productId, reason: 'price validation failed' }] });
        const [answer] = await f.create().updateBases([f.target]);
        expect(answer.transition).toBe('blocked');
        expect(answer.errors[0].message).toContain('price validation failed');
        expect(f.ops.deactivate).not.toHaveBeenCalled();
        expect(f.saved.size).toBe(0);
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

describe('570066-50: действующая скидка делает обычную базу ниже минимума', () => {
    it.each(['keep', 'base', 'floor'])('возвращает обычный прайс после подтверждения акции и процента: %s', async reset => {
        const f = fixture('570066-50');
        const { state, target } = f;
        Object.assign(target, { price: '25896', min_price: '20981', old_price: '33458', ozonCalculated: true, ozonDeadZoneFloor: 20981 });
        Object.assign(state, { price: 19174, minPrice: 18922, oldPrice: 30167, buyerPrice: 15531, buyerPriceCalc: 15531,
            calcMinPrice: 20981, deadZoneFloor: 20981, seller: { ...state.seller, percent: 19 },
            ozonActions: [{ actionId: 1, title: 'Эластичный бустинг', isVoucher: false, participant: true,
                actionPrice: 19174, maxActionPrice: 16236, stock: 0, startsAt: null }],
        });
        let base = 19174;
        const slot = state.ozonActions[0];
        const refresh = () => {
            state.price = slot.participant ? Math.min(base, slot.actionPrice) : base;
        };
        f.products.setPrice.mockImplementation(async ({ prices: [row] }) => {
            f.apply('base ' + row.price, () => {
                base = Number(row.price);
                state.minPrice = Number(row.min_price);
                state.oldPrice = Number(row.old_price);
                if (reset === 'base') slot.actionPrice = base;
                if (reset === 'floor') slot.actionPrice = state.minPrice;
                refresh();
            });
            return { result: [{ offer_id: state.offerId, updated: true }] };
        });
        const remove = () => f.apply('remove', () => { slot.participant = false; refresh(); });
        f.ops.update.mockImplementation(async () => {
            remove();
            return { added: [], removed: [state.productId], unchanged: [], rejected: [] };
        });
        f.ops.deactivate.mockImplementation(async () => { remove(); return [state.productId]; });
        expect((await f.create().updateBases([target]))[0].updated).toBe(true);
        expect(f.writes[0]).toBe('base 25904');
        expect(f.prices.every(price => price === 15531 || price >= 20981)).toBe(true);
        expect(state).toMatchObject({ price: 25896, minPrice: 20981, oldPrice: 33458, buyerPrice: 21235 });
        expect(slot.participant).toBe(false);
        const count = f.writes.length;
        expect((await f.create().updateBases([target]))[0].updated).toBe(true);
        expect(f.writes).toHaveLength(count);
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
    it('пакет заново рассчитывает цель после изменения затрат и подтверждения старого шага', async () => {
        const f = fixture();
        f.delay();
        await f.create().updateBases([f.target]);
        f.deliver();
        f.state.calculationKey = 'new cost';
        const [result] = await f.create().updateBases([f.target], offer => ({
            snapshot: priceUpdateQueue.capture('ozon', [offer]),
        }));
        expect(result.transition).toBe('pending');
        expect(f.saved.size).toBe(0);
        expect(f.writes).toEqual(['percent 11']);
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

describe('569670 — единая цена бустингов', () => {
    function opt() {
        const f = fixture('569670');
        Object.assign(f.state, { price: 292, buyerPrice: 277, buyerPriceCalc: 277, minPrice: 292,
            calcMinPrice: 603, deadZoneFloor: 603,
            seller: { ...f.state.seller, percent: 5 },
            ozonActions: [494, 576, 570, 574, 570].map((maxActionPrice, i) => ({
                actionId: i + 1, title: 'Бустинг ' + i, participant: true, unifiedPrice: true,
                isVoucher: false, stock: 0, startsAt: null, actionPrice: 292, maxActionPrice,
            })),
        });
        const initial = { ...structuredClone(f.state), price: 308, buyerPrice: 293 };
        const plan = () => planPromoPrice(f.state, 603);
        const ticket = f.reserve(f.state.offerId, { goal: plan(), initial, results: [], calculationKey: 'old',
            step: { offerId: f.state.offerId, productId: f.state.productId, buyerPrices: [293], floor: 308,
                change: { kind: 'ozon-set', actionId: 5, title: 'Бустинг 4', from: null, to: 308 } } });
        Object.assign(ticket, { createdAt: '2020-01-01T00:00:00Z' });
        return { ...f, plan, ticket };
    }
    it('устаревший шаг закрывается отдельно, один запрос поднимает цену всех бустингов', async () => {
        const f = opt();
        await f.create().resume();
        expect(f.saved.size).toBe(0);
        expect(f.ops.update).not.toHaveBeenCalled();
        expect(f.plan()).toMatchObject({ unifiedExit: true, ok: true, buyerAfter: 603, floor: 635 });
        f.ops.update.mockImplementation(async (id, rows) => {
            expect(rows).toEqual([{ productId: f.state.productId, stock: 0, actionPrice: 635 }]);
            f.state.price = 635;
            f.state.ozonActions.forEach(a => a.participant = false);
            return { added: [], removed: [f.state.productId], unchanged: [], rejected: [] };
        });
        const answer = await f.create().applyPromo(f.plan(), {});
        expect(answer.verification).toBe('pending');
        await f.create().resume();
        expect(f.saved.size).toBe(1);
        f.state.buyerPrice = f.state.buyerPriceCalc = 603;
        await f.create().resume();
        expect(f.saved.size).toBe(0);
        expect(f.ops.update).toHaveBeenCalledTimes(1);
        expect(f.ops.deactivate).not.toHaveBeenCalled();
    });
    it('за одну ручную отправку снимает устаревший шаг, подтверждает общий выход и записывает прайс', async () => {
        const f = opt();
        f.ops.update.mockImplementation(async (_id, [row]) => {
            expect(row.actionPrice).toBe(635);
            f.apply('boost exit', () => {
                f.state.price = 635;
                f.state.ozonActions.forEach(a => a.participant = false);
            });
            return { added: [], removed: [f.state.productId], unchanged: [], rejected: [] };
        });
        const [answer] = await f.create().updateBases([{
            offer_id: f.state.offerId, price: '804', min_price: '603', old_price: '1046', currency_code: 'RUB',
        }]);
        expect(answer).toMatchObject({ updated: true, observedBuyerPrice: 603 });
        expect(f.ops.update).toHaveBeenCalledTimes(1);
        expect(f.state).toMatchObject({ minPrice: 603, price: 804, seller: { percent: 25 } });
    });
    it('ручная отправка обновляет также min_price, если бустинги уже отключены', async () => {
        const f = opt();
        Object.assign(f.state, { price: 635, buyerPrice: 603, buyerPriceCalc: 603, oldPrice: 947 });
        f.state.ozonActions.forEach(a => a.participant = false);
        const target = { offer_id: f.state.offerId, price: '635', min_price: '603', old_price: '947', currency_code: 'RUB' as const };
        const [answer] = await f.create().updateBases([target]);
        expect(answer).toMatchObject({ updated: true, observedBuyerPrice: 603 });
        expect(f.state.minPrice).toBe(603);
        expect(f.products.setPrice).toHaveBeenCalledTimes(1);
        expect(f.ops.update).not.toHaveBeenCalled();
    });
    it('сверяет исправленную вручную цену без отправки старых 308 рублей', async () => {
        const f = opt();
        Object.assign(f.state, { price: 635, buyerPrice: 603, buyerPriceCalc: 603 });
        f.state.ozonActions.forEach(a => a.participant = false);
        await f.create().resume();
        expect(f.saved.size).toBe(0);
        expect(f.ops.update).not.toHaveBeenCalled();
    });
    it.each(['recent', 'unchanged', 'inconsistent', 'other listing'])('сохраняет неподтверждённый шаг: %s', async reason => {
        const f = opt();
        if (reason === 'recent') Object.assign(f.ticket, { createdAt: new Date().toISOString() });
        if (reason === 'unchanged') f.ticket.payload.initial = structuredClone(f.state);
        if (reason === 'inconsistent') f.state.buyerPriceCalc = 290;
        if (reason === 'other listing') f.state.productId++;
        await f.create().resume();
        expect(f.saved.size).toBe(1);
        expect(f.ops.update).not.toHaveBeenCalled();
    });
    it('перепланирует старую цену, уже опубликованную в соседних бустингах', async () => {
        const f = opt();
        Object.assign(f.state, { price: 308, buyerPrice: 293, buyerPriceCalc: 293 });
        f.state.ozonActions.forEach(a => a.actionPrice = 308);
        Object.assign(f.state.ozonActions[4], { participant: false, actionPrice: 0 });
        await f.create().resume();
        expect(f.saved.size).toBe(0);
        expect(f.ops.update).not.toHaveBeenCalled();
    });
    it('поднимает общую цену, сохраняя участие там, где лимит допускает целевую цену', async () => {
        const f = opt();
        await f.create().resume();
        f.state.ozonActions[2].maxActionPrice = 660;
        expect(f.plan()).toMatchObject({ unifiedPrice: true, floor: 635, buyerAfter: 603,
            steps: [{ kind: 'ozon-set', actionId: 3, to: 635 }] });
        f.ops.update.mockImplementation(async (id, [row]) => {
            f.apply('shared cap', () => {
                f.state.price = row.actionPrice;
                for (const a of f.state.ozonActions) {
                    a.participant = a.maxActionPrice >= row.actionPrice;
                    a.actionPrice = a.participant ? row.actionPrice : 0;
                }
            });
            return { added: [f.state.productId], removed: [], rejected: [], unchanged: [] };
        });
        expect((await f.create().applyPromo(f.plan(), {})).verification).toBe('confirmed');
        expect(f.ops.update).toHaveBeenCalledTimes(1);
        expect(f.saved.size).toBe(0);
    });
    it('не планирует общий выход при действующем промокоде или подходящем лимите', () => {
        const f = opt();
        f.state.ozonActions[0].isVoucher = true;
        expect(f.plan().unifiedExit).toBeUndefined();
        f.state.ozonActions[0].isVoucher = false;
        f.state.ozonActions[1].maxActionPrice = 635;
        expect(f.plan().unifiedExit).toBeUndefined();
    });
});
