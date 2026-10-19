import { Test } from '@nestjs/testing';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { OzonSellerActionsApi } from './seller-actions.api';

describe('OzonSellerActionsApi — контракт /v1/seller-actions (наша акция, по sku)', () => {
    let api: OzonSellerActionsApi;
    const method = jest.fn();
    const apiProduct = (productId: number, over: any = {}) => ({
        product_id: productId,
        sku: [productId * 10],
        offer_id: String(productId),
        name: 'n',
        base_price: 321,
        price: 255,
        min_seller_price: 213,
        action_price: 243,
        discount_percent: 5,
        currency: 'RUB',
        is_active: true,
        ...over,
    });
    const apiAction = (id: number, over: any = {}) => ({
        action_id: id,
        action_parameters: {
            title: '26-10',
            date_start: '2026-10-01T21:00:00Z',
            date_end: '2026-10-31T20:59:59Z',
            status: 'ACTIVE',
            discount_type: 'PERCENT',
            min_action_percent: 5,
        },
        is_participated: true,
        sku_count: 604,
        is_turn_on: true,
        ...over,
    });

    beforeEach(async () => {
        method.mockReset();
        const module = await Test.createTestingModule({
            providers: [OzonSellerActionsApi, { provide: OzonApiService, useValue: { method } }],
        }).compile();
        api = module.get(OzonSellerActionsApi);
    });

    it('listActions — action_parameters разворачиваются в плоскую акцию', async () => {
        method.mockResolvedValue({ actions: [apiAction(4376619)], total: 1 });
        expect(await api.listActions()).toEqual([
            {
                id: 4376619,
                title: '26-10',
                discountType: 'PERCENT',
                minPercent: 5,
                dateStart: '2026-10-01T21:00:00Z',
                dateEnd: '2026-10-31T20:59:59Z',
                status: 'ACTIVE',
                isOn: true,
                skuCount: 604,
            },
        ]);
        expect(method).toHaveBeenCalledWith('/v1/seller-actions/list', { limit: 100, offset: 0 });
    });

    it('activeAction — только ACTIVE и включённая; нет такой → null', async () => {
        method.mockResolvedValue({
            actions: [
                apiAction(1, { is_turn_on: false }),
                apiAction(2, { action_parameters: { ...apiAction(2).action_parameters, status: 'FINISHED' } }),
                apiAction(3),
            ],
        });
        expect((await api.activeAction())?.id).toBe(3);
        method.mockResolvedValue({ actions: [apiAction(1, { is_turn_on: false })] });
        expect(await api.activeAction()).toBeNull();
    });

    it('page — sku из массива первым элементом, числа как есть, cursor наружу', async () => {
        method.mockResolvedValue({ products: [apiProduct(7)], has_next: true, cursor: '{"last_used_sku":70}' });
        const page = await api.page('list', 4376619);
        expect(method).toHaveBeenCalledWith('/v1/seller-actions/products/list', { action_id: 4376619, limit: 100 });
        expect(page).toEqual({
            products: [
                {
                    productId: 7,
                    sku: 70,
                    offerId: '7',
                    name: 'n',
                    basePrice: 321,
                    price: 255,
                    minSellerPrice: 213,
                    actionPrice: 243,
                    percent: 5,
                    isActive: true,
                },
            ],
            hasNext: true,
            cursor: '{"last_used_sku":70}',
        });
    });

    it('listAll — по cursor до has_next:false; offset не шлём', async () => {
        method
            .mockResolvedValueOnce({ products: [apiProduct(1), apiProduct(2)], has_next: true, cursor: 'c1' })
            .mockResolvedValueOnce({ products: [apiProduct(3)], has_next: false, cursor: '' });
        expect(await api.listAll('candidates', 5)).toHaveLength(3);
        expect(method).toHaveBeenNthCalledWith(1, '/v1/seller-actions/products/candidates', {
            action_id: 5,
            limit: 100,
        });
        expect(method).toHaveBeenNthCalledWith(2, '/v1/seller-actions/products/candidates', {
            action_id: 5,
            limit: 100,
            cursor: 'c1',
        });
        expect(method.mock.calls.some((c) => 'offset' in c[1])).toBe(false);
    });

    it('listAll — страховка от зацикливания: та же страница повторно → стоп', async () => {
        method.mockResolvedValue({ products: [apiProduct(1)], has_next: true, cursor: 'same' });
        expect(await api.listAll('list', 5)).toHaveLength(1);
        expect(method).toHaveBeenCalledTimes(2);
    });

    it('setPercent — add с discount_percent; `{}` = применено', async () => {
        method.mockResolvedValue({});
        const res = await api.setPercent(4376619, [{ sku: 2360940454, percent: 6 }]);
        expect(method).toHaveBeenCalledWith('/v1/seller-actions/products/add', {
            action_id: 4376619,
            products: [{ sku: 2360940454, discount_percent: 6 }],
        });
        expect(res).toEqual({ applied: [{ sku: 2360940454, percent: 6 }], rejected: [] });
    });

    it('setPercent — code5 (ниже min_action_percent / тот же процент) → rejected с причиной, не исключение', async () => {
        method.mockResolvedValue({
            result: null,
            error: { service_message: 'Request failed with status code 400', message: 'no activated products found' },
        });
        const res = await api.setPercent(4376619, [{ sku: 1, percent: 4 }]);
        expect(res).toEqual({ applied: [], rejected: [{ sku: 1, reason: 'no activated products found' }] });
    });

    it('setPercent — пустой список не уходит в API', async () => {
        expect(await api.setPercent(1, [])).toEqual({ applied: [], rejected: [] });
        expect(method).not.toHaveBeenCalled();
    });
});
