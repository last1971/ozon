import { WbCurrentPricesService } from './wb.current-prices.service';

describe('WbCurrentPricesService', () => {
    const good = (vendorCode: string, price: number, discount: number, discountedPrice?: number) => ({
        nmID: Number(vendorCode.replace(/\D/g, '')),
        vendorCode,
        discount,
        sizes: [{ price, ...(discountedPrice !== undefined ? { discountedPrice } : {}) }],
    });

    it('цена со скидкой из ВБ, а если её нет — базовая минус наша скидка', async () => {
        const method = jest.fn().mockResolvedValue({
            data: { listGoods: [good('570491', 470, 20, 376), good('568615-2', 1000, 10)] },
        });
        const map = await new WbCurrentPricesService({ method } as any).getAll();
        expect(map.get('570491')).toEqual({ nmID: 570491, price: 470, discount: 20, discountedPrice: 376 });
        expect(map.get('568615-2')).toEqual({ nmID: 5686152, price: 1000, discount: 10, discountedPrice: 900 });
        expect(method).toHaveBeenCalledWith(
            'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter',
            'get',
            { limit: 1000, offset: 0 },
            true,
        );
    });

    it('постранично, пока страница полная', async () => {
        const full = Array.from({ length: 1000 }, (_, i) => good(String(100000 + i), 100, 0, 100));
        const method = jest
            .fn()
            .mockResolvedValueOnce({ data: { listGoods: full } })
            .mockResolvedValueOnce({ data: { listGoods: [good('999999', 50, 0, 50)] } });
        const map = await new WbCurrentPricesService({ method } as any).getAll();
        expect(map.size).toBe(1001);
        expect(method.mock.calls[1][2]).toEqual({ limit: 1000, offset: 1000 });
    });
});
