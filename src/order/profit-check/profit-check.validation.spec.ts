import { evaluateLine } from './profit-check.calculator';
import { calculatePay } from '../../helpers/price/price.helpers';
import { WbOrderService } from '../../wb.order/wb.order.service';

const input = {
    offer_id: '123',
    incoming_price: 100,
    available_price: 0,
    min_perc: 20,
    perc: 40,
    old_perc: 80,
    adv_perc: 0,
    sum_pack: 0,
    sales_percent: 20,
    fbs_direct_flow_trans_max_amount: 10,
};
const coeffs = { minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 };
const line = { offer_id: '123', units: 1, pricePerUnit: 200 };
it.each([NaN, Infinity, -Infinity])('некорректная цена %s не даёт нормального вердикта, база сохранена', (value) => {
    expect(evaluateLine({ ...line, pricePerUnit: value }, input, coeffs, 1)).toMatchObject({
        level: 'skip',
        failureKind: 'invalid-data',
        cost: 100,
    });
});
it.each([0, -1, 0.5, Infinity, NaN])('некорректное количество %s не даёт нормального вердикта', (units) => {
    expect(evaluateLine({ ...line, units }, input, coeffs, 1)).toMatchObject({
        level: 'skip',
        failureKind: 'invalid-data',
    });
});
it.each([Infinity, NaN])('некорректная себестоимость %s не даёт нормального вердикта', (value) => {
    expect(evaluateLine(line, { ...input, incoming_price: value }, coeffs, 1)).toMatchObject({
        level: 'skip',
        failureKind: 'invalid-data',
    });
});
it('некорректный результат общей формулы не становится нормой', () => {
    expect(evaluateLine(line, { ...input, sales_percent: NaN }, coeffs, 1)).toMatchObject({
        level: 'skip',
        failureKind: 'invalid-data',
        cost: 100,
    });
});
it('процент прибыли считается от себестоимости, не от цены покупателю', () => {
    const v = evaluateLine(line, input, coeffs, 1);
    const pay = calculatePay(input, coeffs, line.pricePerUnit);
    const profit = pay.netProfit ?? pay.pay - input.incoming_price;
    expect(v.profitPercent).toBeCloseTo((profit / input.incoming_price) * 100, 2);
    expect(v.profitPercent).not.toBeCloseTo((profit / line.pricePerUnit) * 100, 2);
});
it('WB: точный srid и priceWithDisc, чужая строка и цена покупателя finishedPrice не используются', async () => {
    const source = Object.create(WbOrderService.prototype) as WbOrderService;
    (source as any).getOrders = jest.fn().mockResolvedValue([
        { srid: 'exact', supplierArticle: '123', priceWithDisc: 200, finishedPrice: 150, totalPrice: 300 },
        { srid: 'foreign', supplierArticle: '123', priceWithDisc: 500, finishedPrice: 400 },
    ]);
    expect(
        (await source.lookupSalePrices([{ posting: 'one', externalId: 'exact', since: new Date() }])).get('exact'),
    ).toEqual([{ offer_id: '123', units: 1, pricePerUnit: 200 }]);
});
it.each([null, { status: 'NotOk', error: { status: 503 } }])(
    'WB: не-массив статистики не маскируется под отсутствие заказов',
    async (response) => {
        const source = Object.create(WbOrderService.prototype) as WbOrderService;
        (source as any).getOrders = jest.fn().mockResolvedValue(response);
        await expect(
            source.lookupSalePrices([{ posting: 'one', externalId: 'exact', since: new Date() }]),
        ).rejects.toThrow('ответ статистики');
    },
);
