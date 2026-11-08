import { pricingStocks } from './pricing-stock';
const own = (quantity: number, reserve = 0) => ({
    in: jest.fn().mockResolvedValue([{ code: '123', quantity, reserve }]),
});
it('нулевые остатки на обоих складах — обычный пропуск', async () => {
    const read = jest.fn().mockResolvedValue(new Map([['123', 0]]));
    expect((await pricingStocks(['123'], own(0), read)).get('123')).toEqual({ state: 'empty', marketplace: 0 });
});
it('товар только на складе площадки остаётся доступным', async () => {
    expect((await pricingStocks(['123'], own(0), async () => new Map([['123', 2]]))).get('123')).toEqual({
        state: 'available',
        marketplace: 2,
    });
});
it('при достаточном свободном остатке не читает площадку', async () => {
    const read = jest.fn();
    expect((await pricingStocks(['123-5'], own(7, 2), read)).get('123-5')?.state).toBe('available');
    expect(read).not.toHaveBeenCalled();
});
it('резерв и размер упаковки не позволяют продать отсутствующую пачку', async () => {
    expect((await pricingStocks(['123-5'], own(7, 3), async () => new Map([['123-5', 0]]))).get('123-5')?.state).toBe(
        'empty',
    );
});
it('отсутствие складской строки не прячет остаток площадки', async () => {
    expect(
        (await pricingStocks(['123'], { in: jest.fn().mockResolvedValue([]) }, async () => new Map([['123', 1]]))).get(
            '123',
        )?.state,
    ).toBe('available');
});
it.each([undefined, NaN, Infinity, -1])(
    'неизвестный или некорректный остаток %s не становится нулём',
    async (value) => {
        expect((await pricingStocks(['123'], own(0), async () => new Map([['123', value]]))).get('123')?.state).toBe(
            'unknown',
        );
    },
);
it('сбой API не превращает товар в отсутствующий и не мешает товару на нашем складе', async () => {
    const goods = { in: jest.fn().mockResolvedValue([{ code: '123', quantity: 10, reserve: 0 }]) };
    const result = await pricingStocks(['123', '456'], goods, async () => {
        throw Error('503');
    });
    expect(result.get('123')?.state).toBe('available');
    expect(result.get('456')?.state).toBe('unknown');
});
it('пустой набор не вызывает загрузки', async () => {
    const goods = own(0),
        read = jest.fn();
    expect((await pricingStocks([], goods, read)).size).toBe(0);
    expect(goods.in).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
});

it('артикулы с фасовкой 1 и 5 читают общий код Firebird', async () => {
    const goods = own(10),
        read = jest.fn();
    expect((await pricingStocks(['123-1', '123-5'], goods, read)).get('123-1')?.state).toBe('available');
    expect(goods.in).toHaveBeenCalledWith(['123'], null);
    expect(read).not.toHaveBeenCalled();
});
it('из остатка Ozon FBS нельзя выводить наличие на складах WB', async () => {
    const readWb = jest.fn().mockResolvedValue(new Map([['123', 0]]));
    expect((await pricingStocks(['123'], own(0), readWb)).get('123')?.state).toBe('empty');
    expect(readWb).toHaveBeenCalledWith(['123']);
});

it('большой каталог читает склад ограниченными пачками и не теряет последнюю', async () => {
    const offers = Array.from({ length: 1201 }, (_, i) => String(i + 1));
    const goods = { in: jest.fn(async (codes) => codes.map((code) => ({ code, quantity: 1, reserve: 0 }))) };
    const marketplace = jest.fn();
    const stocks = await pricingStocks(offers, goods, marketplace);
    expect(goods.in.mock.calls.map(([ids]) => ids.length)).toEqual([500, 500, 201]);
    expect(stocks.size).toBe(1201);
    expect(stocks.get('1201')?.state).toBe('available');
    expect(marketplace).not.toHaveBeenCalled();
});
