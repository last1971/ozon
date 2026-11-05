import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import axios from '@/axios.config';
import { priceStore } from '@/stores/prices';
import type { PriceDto } from '@/contracts/price.dto';
import Prices from '../Prices.vue';

vi.mock('@/axios.config', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const price = (): PriceDto => ({
    product_id: 123,
    offer_id: '123-5',
    name: 'Товар',
    marketing_price: 900,
    marketing_seller_price: 850,
    available_price: 0,
    incoming_price: 100,
    min_price: 800,
    price: 900,
    old_price: 1000,
    min_perc: 20,
    perc: 40,
    old_perc: 80,
    adv_perc: 2,
    sales_percent: 0,
    fbs_direct_flow_trans_max_amount: 20,
    auto_action_enabled: false,
    sum_pack: 3,
    fbsCount: 10,
    fboCount: 0,
});
const fields = ['old_perc', 'min_perc', 'perc', 'adv_perc', 'sum_pack', 'incoming_price', 'available_price'] as const;
const posts = (url: string) => vi.mocked(axios.post).mock.calls.filter(([path]) => path === url);
const ozonRequests = () =>
    vi.mocked(axios.get).mock.calls.filter(([path]) => path.startsWith('/api/price/ozon-pricing/'));
let wrapper: VueWrapper | undefined;

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    setActivePinia(createPinia());
    vi.mocked(axios.get).mockImplementation(async (url) => {
        if (url === '/api/price') return { data: { data: [price()] } };
        if (url.startsWith('/api/price/ozon-pricing/'))
            return {
                data: {
                    offerId: '123-5',
                    base: 100,
                    baseSource: 'market',
                    min: null,
                    normal: null,
                    max: null,
                    costs: null,
                    current: null,
                },
            };
        throw new Error(`Неожиданный GET ${url}`);
    });
    vi.mocked(axios.post).mockImplementation(async (url) => {
        if (url === '/api/price/calculate') return { data: { min_price: 229, price: 258, old_price: 800 } };
        if (url === '/api/price/calculate-pay') return { data: Array.from({ length: 4 }, () => ({ pay: 200 })) };
        throw new Error(`Неожиданный POST ${url}`);
    });
});
afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
});
async function renderPrices() {
    const store = priceStore();
    await store.get();
    wrapper = mount(Prices, {
        global: {
            stubs: {
                VContainer: { template: '<div><slot /></div>' },
                VCard: { template: '<div><slot /></div>' },
                VTable: { template: '<table><slot /></table>' },
                VRow: { template: '<div><slot /></div>' },
                VCol: { template: '<div><slot /></div>' },
                VDivider: true,
                VTextField: true,
                VSwitch: true,
                VBtn: true,
                PricePromo: true,
                PriceSendDialog: true,
                VAlert: true,
            },
        },
    });
    await nextTick();
    vi.mocked(axios.get).mockClear();
    vi.mocked(axios.post).mockClear();
    return store;
}
async function minute() {
    await nextTick();
    await vi.advanceTimersByTimeAsync(60_000);
    await nextTick();
}

describe('Пересчёт на смонтированном экране Prices', () => {
    it.each(fields)('одна правка %s за 60 секунд вызывает ровно один расчёт Ozon без цикла', async (field) => {
        const store = await renderPrices();
        const before = store.prices[0];
        store.prices[0][field] += 1;
        await minute();
        expect(posts('/api/price/calculate')).toHaveLength(0);
        expect(ozonRequests()).toHaveLength(1);
        expect(posts('/api/price/calculate-pay')).toHaveLength(0);
        expect(ozonRequests().length).toBeGreaterThanOrEqual(1);
        expect(ozonRequests().length).toBeLessThanOrEqual(2);
        // Пересчёт больше не подменяет текущую цену Ozon расчётной.
        expect(store.prices[0]).toBe(before);
        expect(store.prices[0].min_price).toBe(800);
        expect(store.ozonPricingLoading['123-5']).toBe(false);
    });
    it('замена объекта с прежними семью значениями не запускает расчёт', async () => {
        const store = await renderPrices();
        store.prices[0] = { ...store.prices[0], name: 'Новое название', min_price: 230 };
        await minute();
        expect(axios.post).not.toHaveBeenCalled();
        expect(ozonRequests()).toHaveLength(0);
    });
    it('ловит изменения двух полей, даже если их сумма осталась прежней', async () => {
        const store = await renderPrices();
        store.prices[0].perc += 1;
        store.prices[0].min_perc -= 1;
        await minute();
        expect(posts('/api/price/calculate')).toHaveLength(0);
        expect(ozonRequests()).toHaveLength(1);
        expect(ozonRequests().length).toBeLessThanOrEqual(2);
    });
    it('объединяет быстрые правки, но пересчитывает следующую отдельную правку', async () => {
        const store = await renderPrices();
        store.prices[0].perc += 1;
        await nextTick();
        await vi.advanceTimersByTimeAsync(1000);
        store.prices[0].perc += 1;
        await minute();
        expect(posts('/api/price/calculate')).toHaveLength(0);
        expect(ozonRequests()).toHaveLength(1);
        store.prices[0].perc += 1;
        await minute();
        expect(posts('/api/price/calculate')).toHaveLength(0);
        expect(ozonRequests()).toHaveLength(2);
        expect(ozonRequests().length).toBeLessThanOrEqual(4);
    });
});
