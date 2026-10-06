import { Test } from '@nestjs/testing';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { OzonPromosApi } from './promos.api';

describe('OzonPromosApi — контракт Seller API по акциям (v2, 13.10.2026)', () => {
    let api: OzonPromosApi;
    const method = jest.fn();
    const money = (amount: string) => ({ amount, currency: '' });
    const apiProduct = (id: number, over: any = {}) => ({
        id,
        price: money('2023'),
        action_price: money('1554'),
        max_action_price: money('1554'),
        add_mode: 'AUTO',
        stock: 0,
        min_stock: 0,
        recommended_stock: 0,
        website_prices: {},
        ...over,
    });

    beforeEach(async () => {
        method.mockReset();
        const module = await Test.createTestingModule({
            providers: [OzonPromosApi, { provide: OzonApiService, useValue: { method } }],
        }).compile();
        api = module.get(OzonPromosApi);
    });

    it('listActions — GET /v1/actions, result как есть', async () => {
        method.mockResolvedValue({ result: [{ id: 1, is_voucher_action: false }] });
        expect(await api.listActions()).toEqual([{ id: 1, is_voucher_action: false }]);
        expect(method).toHaveBeenCalledWith('/v1/actions', {}, 'get');
    });

    it('page — v2, Money → числа, без result-обёртки, last_id наружу', async () => {
        method.mockResolvedValue({ products: [apiProduct(7)], total: 17, last_id: '7' });
        const page = await api.page('products', 4361400);
        expect(method).toHaveBeenCalledWith('/v2/actions/products', { action_id: 4361400, limit: 100 });
        expect(page).toEqual({
            products: [
                { id: 7, price: 2023, actionPrice: 1554, maxActionPrice: 1554, stock: 0, minStock: 0, addMode: 'AUTO' },
            ],
            total: 17,
            lastId: '7',
        });
    });

    it('listAll — листает по last_id до неполной страницы; у кандидатов нет add_mode', async () => {
        const full = Array.from({ length: 100 }, (_, i) => apiProduct(i + 1, { add_mode: undefined }));
        method.mockResolvedValueOnce({ products: full, total: 101, last_id: '100' }).mockResolvedValueOnce({
            products: [apiProduct(101, { add_mode: undefined })],
            total: 101,
            last_id: '101',
        });
        const all = await api.listAll('candidates', 5);
        expect(all).toHaveLength(101);
        expect(all[0]).not.toHaveProperty('addMode');
        expect(method).toHaveBeenNthCalledWith(1, '/v2/actions/candidates', { action_id: 5, limit: 100 });
        expect(method).toHaveBeenNthCalledWith(2, '/v2/actions/candidates', {
            action_id: 5,
            limit: 100,
            last_id: '100',
        });
    });

    it('listAll — страховка от зацикливания: last_id не сдвинулся → стоп', async () => {
        const full = Array.from({ length: 100 }, (_, i) => apiProduct(i + 1));
        method.mockResolvedValue({ products: full, total: 1000, last_id: '100' });
        expect(await api.listAll('products', 5)).toHaveLength(200);
        expect(method).toHaveBeenCalledTimes(2);
    });

    it('update — action_price ТОЛЬКО Money (число даёт proto syntax error); ответ двумя списками', async () => {
        method.mockResolvedValue({
            active_product_ids: [1],
            deactivated_product_ids: [2],
            rejected: [{ product_id: 3, reason: 'product ID: 3 not found' }],
            warnings: [],
        });
        const res = await api.update(9, [
            { productId: 1, actionPrice: 1554, stock: 0 },
            { productId: 2, actionPrice: 9999, stock: 0 },
        ]);
        expect(method).toHaveBeenCalledWith('/v1/actions/products/update', {
            action_id: 9,
            products: [
                { product_id: 1, action_price: { amount: '1554', currency: 'RUB' }, stock: 0 },
                { product_id: 2, action_price: { amount: '9999', currency: 'RUB' }, stock: 0 },
            ],
        });
        expect(res).toEqual({
            added: [1],
            removed: [2],
            rejected: [{ productId: 3, reason: 'product ID: 3 not found' }],
            warnings: [],
        });
    });

    it('update/deactivate — пустой список не уходит в API (там 400 на пустой массив)', async () => {
        expect(await api.update(9, [])).toEqual({ added: [], removed: [], rejected: [], warnings: [] });
        expect(await api.deactivate(9, [])).toEqual([]);
        expect(method).not.toHaveBeenCalled();
    });

    it('deactivate — v2, плоский product_ids', async () => {
        method.mockResolvedValue({ product_ids: [5] });
        expect(await api.deactivate(9, [5, 6])).toEqual([5]);
        expect(method).toHaveBeenCalledWith('/v2/actions/products/deactivate', { action_id: 9, product_ids: [5, 6] });
    });
});
