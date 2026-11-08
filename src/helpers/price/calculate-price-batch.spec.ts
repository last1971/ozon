import { calculatePriceBatch } from './calculate-price-batch';
import { calculatePrice, calculatePay, calculateCosts } from './price.helpers';
const coeffs = { sumObtain: 0, sumLabel: 0, percEkv: 1, percMil: 0, minMil: 0, taxUnit: 6 };
const input = (offer_id: string) => ({
    offer_id,
    incoming_price: 100,
    available_price: 0,
    min_perc: 20,
    perc: 40,
    old_perc: 80,
    adv_perc: 0,
    sum_pack: 0,
    sales_percent: 20,
    fbs_direct_flow_trans_max_amount: 10,
});
it('одна неверная строка не останавливает две исправные и не меняет формулу', async () => {
    const a = input('1'),
        b = { ...input('2'), min_perc: NaN },
        c = input('3');
    const result = await calculatePriceBatch([a, b, c], coeffs);
    expect(result.prices).toEqual([calculatePrice(a, coeffs), calculatePrice(c, coeffs)]);
    expect(result.skipped).toEqual([
        { offer_id: '2', reason: 'pricing-data', failureKind: 'data', message: 'Получены некорректные цены' },
    ]);
});
it('отмена не возвращает частично рассчитанный набор для отправки', async () => {
    await expect(
        calculatePriceBatch([input('1')], coeffs, { stopChain: true, progress: { done: 0, counters: {} } }),
    ).rejects.toThrow('остановлена');
});
it('неполная карточка с ошибкой тарифа не может перейти на старый общий расчёт', () => {
    const row = { ...input('1'), pricingError: 'Нет тарифа' };
    expect(() => calculatePrice(row, coeffs)).toThrow('Нет тарифа');
    expect(() => calculatePay(row, coeffs, 400)).toThrow('Нет тарифа');
    expect(() => calculateCosts(row, coeffs)).toThrow('Нет тарифа');
});
