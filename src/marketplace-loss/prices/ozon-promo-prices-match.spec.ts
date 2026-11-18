import { ozonPromoPricesMatch } from './ozon-promo-prices-match';
import { PromoPriceState } from '../../promos/price-lever/promo-price.types';
import { calculatePrice } from '../../helpers/price/price.helpers';
import { IPriceable } from '../../interfaces/i.priceable';

const now = new Date('2026-11-14T14:01:05Z');
const normal = { offer_id: '535776', currency_code: 'RUB', price: '699', old_price: '837', min_price: '279' };
const state = (over: Partial<PromoPriceState> = {}): PromoPriceState => ({
    offerId: '535776',
    productId: 1,
    price: 294,
    confirmedBase: 699,
    minPrice: 279,
    oldPrice: 837,
    buyerPrice: 279,
    buyerPriceCalc: 279,
    seller: { actionId: 2, title: '26-11', sku: 1, isActive: true, percent: 5, minPercent: 5 },
    ozonActions: [
        {
            actionId: 1,
            title: 'Бустинг',
            participant: true,
            isVoucher: false,
            actionPrice: 294,
            maxActionPrice: 600,
            stock: 1,
            startsAt: null,
        },
    ],
    ...over,
});
const actual = (s = state()) => ({ price: s.price, min_price: s.minPrice, old_price: s.oldPrice, promoState: s });

it('563967-4: подтверждает 632 при повторном приходе, учитывает следующий приход и тариф', () => {
    const low = { min: 0, max: 300, minIncluded: true, maxIncluded: true };
    const high = { min: 300, max: null, minIncluded: false, maxIncluded: false };
    const input: IPriceable = {
        offer_id: '563967-4', incoming_price: 100, available_price: 0, sales_percent: 0,
        min_perc: 10, perc: 55, old_perc: 145, adv_perc: 0, sum_pack: 0, fbs_direct_flow_trans_max_amount: 0,
        ozon: {
            minProfitRub: 0, minMarkupPercent: 0, acquiringRate: 0, vatRate: 0, profitTaxRate: 0,
            schemes: [{ scheme: 'fbs', firstMile: 0, lastMile: 0,
                commissions: [{ ...low, rate: 0 }, { ...high, rate: 0 }],
                logistics: [{ ...low, amount: 188 }, { ...high, amount: 517 }],
            }],
        },
    };
    const coeffs = { minMil: 0, percMil: 0, percEkv: 0, sumObtain: 0, sumLabel: 0, taxUnit: 0 };
    const target = calculatePrice(input, coeffs);
    expect(target).toMatchObject({ price: '672', old_price: '762', min_price: '298', ozonDeadZoneFloor: 627 });
    const s = state({
        offerId: input.offer_id, price: 672, oldPrice: 762, minPrice: 298,
        buyerPrice: 632, buyerPriceCalc: 632, seller: { ...state().seller, percent: 6 }, ozonActions: [],
    });
    expect(ozonPromoPricesMatch(target, actual(s), now)).toBe(true);
    expect(ozonPromoPricesMatch(target, actual({ ...s, buyerPrice: 302, buyerPriceCalc: 302,
        seller: { ...s.seller, percent: 55 } }), now)).toBe(false);
    const changed = calculatePrice({ ...input, incoming_price: 110 }, coeffs);
    expect(ozonPromoPricesMatch(changed, actual(s), now)).toBe(false);
});

it.each([
    ['503760', 265, 233, 233, 233, 774, 0],
    ['488434-2', 683, 285, 271, 270, 812, 5],
    ['497215-10', 654, 294, 279, 279, 797, 5],
    ['535776', 699, 294, 279, 279, 837, 5],
])(
    'снимок 14.11: %s — акционная цена не сбрасывается к normal',
    (offer, reference, price, buyer, min, old, percent) => {
        const s = state();
        Object.assign(s, {
            offerId: String(offer),
            price,
            confirmedBase: Number(reference),
            buyerPrice: buyer,
            buyerPriceCalc: buyer,
            minPrice: min,
            oldPrice: old,
        });
        s.ozonActions[0].actionPrice = Number(price);
        if (!percent) s.seller = null;
        const target = {
            ...normal,
            offer_id: String(offer),
            price: String(reference),
            min_price: String(min),
            old_price: String(old),
        };
        const before = structuredClone(s);
        expect(ozonPromoPricesMatch(target, actual(s), now)).toBe(true);
        expect(s).toEqual(before);
    },
);
it('новый минимум или зачёркнутая цена требуют обновления, даже при прежней акции', () => {
    expect(ozonPromoPricesMatch({ ...normal, min_price: '280' }, actual(), now)).toBe(false);
    expect(ozonPromoPricesMatch({ ...normal, old_price: '838' }, actual(), now)).toBe(false);
});
it('подтверждение не допускает цену даже на рубль ниже минимума', () => {
    expect(ozonPromoPricesMatch(normal, actual(state({ buyerPrice: 278, buyerPriceCalc: 278 })), now)).toBe(false);
});
it('не принимает лишнее снижение price, неверный процент и неизвестную скидку', () => {
    expect(ozonPromoPricesMatch(normal, actual(state({ price: 293 })), now)).toBe(false);
    const s = state();
    s.seller.percent = 10;
    expect(ozonPromoPricesMatch(normal, actual(s), now)).toBe(false);
    expect(ozonPromoPricesMatch(normal, actual(state({ buyerPriceCalc: 278 })), now)).toBe(false);
});
it('без акции чужая низкая price не заменяет рассчитанную normal', () => {
    expect(ozonPromoPricesMatch(normal, actual(state({ ozonActions: [], seller: null })), now)).toBe(false);
});
it('добавление нового кандидата не сбрасывает уже правильную цену действующей акции', () => {
    const s = state();
    s.ozonActions.push({ ...s.ozonActions[0], actionId: 3, participant: false, actionPrice: 0 });
    expect(ozonPromoPricesMatch(normal, actual(s), now)).toBe(true);
});
it('не скрывает изменившийся лимит акции и цену существующей второй акции', () => {
    const s = state();
    s.ozonActions[0].maxActionPrice = 280;
    expect(ozonPromoPricesMatch(normal, actual(s), now)).toBe(false);
    const second = state();
    second.ozonActions.push({ ...second.ozonActions[0], actionId: 3, actionPrice: 293 });
    expect(ozonPromoPricesMatch(normal, actual(second), now)).toBe(false);
});
it('будущая акция не доказывает, что текущая низкая цена правильная', () => {
    const s = state();
    s.ozonActions[0].startsAt = '2026-11-20T00:00:00Z';
    expect(ozonPromoPricesMatch(normal, actual(s), now)).toBe(false);
});
it('повреждённые / отсутствующие ответы не принимаются за успешную настройку', () => {
    expect(ozonPromoPricesMatch(normal, undefined, now)).toBe(false);
    expect(ozonPromoPricesMatch(normal, { ...actual(), min_price: undefined }, now)).toBe(false);
    expect(ozonPromoPricesMatch(normal, { ...actual(), old_price: undefined }, now)).toBe(false);
    expect(ozonPromoPricesMatch({ ...normal, price: undefined }, actual(), now)).toBe(false);
    expect(ozonPromoPricesMatch(normal, actual(state({ offerId: 'other' })), now)).toBe(false);
});
it('seller-only и отсутствие акций сохраняют normal, итоговая цена всё равно проверяется', () => {
    const target = { ...normal, price: '300', min_price: '270' };
    const s = state({ price: 300, minPrice: 270, buyerPrice: 270, buyerPriceCalc: 270, ozonActions: [] });
    s.seller.percent = 10;
    expect(ozonPromoPricesMatch(target, actual(s), now)).toBe(true);
    expect(
        ozonPromoPricesMatch(
            normal,
            actual(state({ price: 699, buyerPrice: 699, buyerPriceCalc: 699, ozonActions: [], seller: null })),
            now,
        ),
    ).toBe(true);
});

it('более дорогая вторая акция не вызывает повторный сброс правильной цены', () => {
    const s = state();
    s.ozonActions.push({ ...s.ozonActions[0], actionId: 3, actionPrice: 350 });
    expect(ozonPromoPricesMatch(normal, actual(s), now)).toBe(true);
});

it('повтор прихода подтверждает фактическую цену с обязательной скидкой по исходному расчёту', () => {
    const target = {...normal, ozonCalculated: true, price: '130', old_price: '151', min_price: '128'};
    const s = state({price: 135, confirmedBase: 135, oldPrice: 156, minPrice: 128, buyerPrice: 128, buyerPriceCalc: 128});
    s.ozonActions = [{...s.ozonActions[0], actionPrice: 135, maxActionPrice: 195}];
    expect(ozonPromoPricesMatch(target, actual(s), now)).toBe(true);
    expect(ozonPromoPricesMatch({...target, ozonCalculated:false}, actual(s), now)).toBe(false);
    expect(ozonPromoPricesMatch(target, actual({...s, oldPrice: 151}), now)).toBe(false);
});

it('акция может скрывать большую базовую цену даже когда видимая равна целевой', () => {
    const s = state({confirmedBase:undefined, price:294});
    const target = {...normal, price:'294'};
    expect(ozonPromoPricesMatch(target, actual(s), now)).toBe(false);
    expect(ozonPromoPricesMatch(target, actual({...s, confirmedBase:699}), now)).toBe(false);
    expect(ozonPromoPricesMatch(target, actual({...s, confirmedBase:294}), now)).toBe(true);
});
