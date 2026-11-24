import { PromoPriceApplyResult, PromoPriceState, PromoPriceStep } from '../promo-price.types';
import { verifySweepChanges } from './verify-sweep-changes';

const offers = ['549754-5', '335931-10', '563040-5', '503760-5', '534286', '362465-10', '539124'];

function example(offerId: string, id: number) {
    const price = 710, actionId = 1977747;
    const seller = { actionId: 4474503, title: '26-11', minPercent: 5, sku: id + 10, percent: 5, isActive: true };
    const action = { actionId, title: 'Бустинг', isVoucher: false, actionPrice: price,
        maxActionPrice: price, participant: true, stock: 1, startsAt: null };
    const state: PromoPriceState = { offerId, productId: id, price, oldPrice: 900, minPrice: 258,
        buyerPrice: 675, buyerPriceCalc: 675, ozonActions: [action], seller };
    const setPercent = offerId === '539124';
    const step: PromoPriceStep = setPercent
        ? { kind: 'percent', actionId: seller.actionId, sku: seller.sku, from: 5, to: 63 }
        : { kind: 'ozon-set', title: action.title, actionId, from: price, to: 310 };
    const buyerAfter = setPercent ? 263 : 295;
    const plan: PromoPriceApplyResult = { offerId, productId: id, state, buyerBefore: state.buyerPrice, buyerAfter,
        target: 258, percent: setPercent ? 63 : 5, floor: 258, baseAfter: setPercent ? price : 310,
        steps: [step], results: [{ step, status: 'ok', ...(setPercent ? {} : { changed: true }) }],
        applied: true, attempted: true, ok: true, closest: false, notes: [] };
    const actual: PromoPriceState = { ...state, buyerPrice: buyerAfter,
        seller: setPercent ? { ...seller, percent: 63 } : seller,
        ozonActions: [setPercent ? action : { ...action, actionPrice: 310 }] };
    return { plan, actual };
}

it('читает шесть изменений цены акции и один процент продавца одним снимком; проверяет цену и участие', async () => {
    const examples = offers.map(example);
    const states = examples.map(e => e.actual);
    const rows = examples.map(e => e.plan);
    states[0].buyerPrice = rows[0].buyerBefore;
    states[1].ozonActions[0].participant = false;
    rows[2].results[0].changed = false;
    const allStates = jest.fn(async () => states);
    await verifySweepChanges(rows, { allStates });
    expect(allStates.mock.calls).toEqual([[offers]]);
    expect(rows.map(r => r.verification)).toEqual(['pending','pending','unchanged','confirmed','confirmed','confirmed','confirmed']);
    expect(rows[0].observedBuyerPrice).toBe(rows[0].buyerBefore);
    expect(rows[6].results[0].changed).toBe(true);
    states[6].seller.percent = 5;
    delete rows[6].verification;
    await verifySweepChanges(rows, { allStates });
    expect(rows[6].verification).toBe('pending');
});

it('ошибка чтения оставляет принятый запрос в ожидании следующей сверки', async () => {
    const { plan } = example(offers[0], 1);
    await verifySweepChanges([plan], { allStates: jest.fn().mockRejectedValue(new Error('429')) });
    expect(plan).toMatchObject({ applied: true, verification: 'pending' });
    expect(plan.notes.join()).toContain('429');
});
