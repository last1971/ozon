import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { PromoPriceState } from '../../promos/price-lever/promo-price.types';
import { buyerPrice } from './buyer.price.helper';
import { observedOzonBase, resolveOzonBaseTarget } from './ozon-base-target';

const target = {
    ozonCalculated: true,
    offer_id: '550611',
    price: '130',
    old_price: '151',
    min_price: '128',
    currency_code: 'RUB',
};
const seller = { actionId: 1, sku: 2, title: 'sale', isActive: true, minPercent: 5, percent: 5 };

it.each([
    [159, 152, 160],
    [130, 128, 135],
    [2773, 2693, 2835],
    [19419, 18575, 19553],
])('computes the smallest list price for normal %i, minimum %i', (normal, min, expected) => {
    const input: UpdatePriceDto = { ...target, price: String(normal), min_price: String(min) };
    const state = { seller };
    const result = resolveOzonBaseTarget(input, state);
    expect(Number(result.price)).toBe(expected);
    expect(buyerPrice(expected, [], 5)).toBe(min);
    expect(buyerPrice(expected - 1, [], 5)).toBeLessThan(min);
    expect(result.min_price).toBe(input.min_price);
    expect(resolveOzonBaseTarget(result, state)).toBe(result);
    expect(resolveOzonBaseTarget(input, { seller: { ...seller, percent: 25 } })).toEqual(result);
});

it('respects manually requested amounts, inactive enrollment and a reachable existing goal', () => {
    const manual = { ...target, ozonCalculated: false };
    const valid = { ...target, price: '300' };
    expect(resolveOzonBaseTarget(manual, { seller })).toBe(manual);
    expect(resolveOzonBaseTarget(target, { seller: { ...seller, isActive: false } })).toBe(target);
    expect(resolveOzonBaseTarget(valid, { seller })).toBe(valid);
    expect(resolveOzonBaseTarget(target, { seller: null })).toBe(target);
});

it('preserves disabled strikethrough and updates it only when Ozon requires a larger value', () => {
    expect(resolveOzonBaseTarget(target, { seller }).old_price).toBe('156');
    expect(resolveOzonBaseTarget({ ...target, old_price: '0' }, { seller }).old_price).toBe('0');
});

it('accounts for half-ruble ties without raising the buyer minimum', () => {
    const percent50 = { ...seller, minPercent: 50, percent: 50 };
    const s: Pick<PromoPriceState, 'seller'> = { seller: percent50 };
    expect(resolveOzonBaseTarget({ ...target, price: '199', min_price: '100' }, s).price).toBe('200');
});

it('uses only unmasked coherent prices as direct evidence of the list price', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    const s: PromoPriceState = {
        offerId: 'x',
        productId: 1,
        oldPrice: 151,
        minPrice: 128,
        price: 135,
        buyerPrice: 128,
        buyerPriceCalc: 128,
        seller,
        ozonActions: [],
    };
    const slot = {
        actionId: 2,
        title: 'Ozon',
        isVoucher: false,
        participant: true,
        stock: 5,
        startsAt: null,
        maxActionPrice: 200,
        actionPrice: 135,
    };
    expect(observedOzonBase(s, now)).toBe(135);
    expect(observedOzonBase({ ...s, ozonActions: [slot] }, now)).toBeUndefined();
    expect(observedOzonBase({ ...s, ozonActions: [{ ...slot, startsAt: '2026-11-19T10:00:00Z' }] }, now)).toBe(135);
    expect(
        observedOzonBase({ ...s, ozonActions: [{ ...slot, startsAt: 'unknown', actionPrice: 160 }] }, now),
    ).toBeUndefined();
    expect(observedOzonBase({ ...s, ozonActions: [{ ...slot, actionPrice: 0 }] }, now)).toBeUndefined();
    expect(observedOzonBase({ ...s, buyerPriceCalc: 127 }, now)).toBeUndefined();
});
