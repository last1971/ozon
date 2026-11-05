import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import axios from '../../axios.config';
import { priceStore } from '../prices';
import type { PriceDto } from '@/contracts/price.dto';
import type { OzonPricingResultDto } from '@/contracts/ozon-pricing-result.dto';

vi.mock('../../axios.config', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const price = () =>
    ({
        offer_id: '123-5',
        min_perc: 20,
        perc: 40,
        old_perc: 80,
        adv_perc: 2,
        sum_pack: 3,
        available_price: 0,
        min_price: 800,
        price: 900,
        old_price: 1000,
    }) as PriceDto;
const result = (value = 229): OzonPricingResultDto => ({
    offerId: '123-5',
    base: 100,
    baseSource: 'remaining-lots',
    min: { price: value, profit: 20, commissionRate: 0.2, scheme: 'fbs' },
    normal: null,
    max: null,
    costs: null,
    current: { min: 800, normal: 900, max: 1000 },
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};
beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
});

describe('Загрузка расчёта Ozon в стор', () => {
    it('передаёт редактируемые входы; снимок Ozon и расчёт не заменяют значения верхней таблицы', async () => {
        const store = priceStore();
        store.prices = [price()];
        vi.mocked(axios.get).mockResolvedValue({ data: result() });
        await store.loadOzonPricing('123-5');
        expect(axios.get).toHaveBeenCalledWith('/api/price/ozon-pricing/123-5', {
            params: {
                min_perc: 20,
                perc: 40,
                old_perc: 80,
                adv_perc: 2,
                sum_pack: 3,
                available_price: 0,
            },
        });
        expect(store.ozonPricing['123-5'].min?.price).toBe(229);
        expect(store.ozonPricing['123-5'].current?.min).toBe(800);
        expect(store.prices[0].min_price).toBe(800);
        expect(axios.post).not.toHaveBeenCalled();
        expect(store.ozonPricingLoading['123-5']).toBe(false);
    });
    it('getInd обновляет единый расчёт и не подменяет текущие цены', async () => {
        const store = priceStore();
        store.prices = [price()];
        vi.mocked(axios.post)
            .mockResolvedValueOnce({ data: { min_price: 229, price: 258, old_price: 800 } })
            .mockResolvedValueOnce({ data: [] });
        vi.mocked(axios.get).mockResolvedValue({ data: result() });
        await store.getInd(0);
        expect(store.prices[0].min_price).toBe(800);
        expect(axios.post).not.toHaveBeenCalled();
        expect(store.ozonPricing['123-5'].current?.min).toBe(800);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(store.ozonPricingLoading['123-5']).toBe(false);
    });
    it('calculatePercents пересчитывает один раз с новыми наценками', async () => {
        const store = priceStore();
        store.prices = [price()];
        vi.mocked(axios.post)
            .mockResolvedValueOnce({ data: { min_perc: 50, perc: 60, old_perc: 90 } })
            .mockResolvedValueOnce({ data: { min_price: 280, price: 750, old_price: 825 } })
            .mockResolvedValueOnce({ data: [] });
        vi.mocked(axios.get).mockResolvedValue({ data: result(280) });
        await store.calculatePercents(0);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.get).toHaveBeenCalledWith(expect.any(String), {
            params: expect.objectContaining({ min_perc: 50, perc: 60, old_perc: 90 }),
        });
        expect(store.ozonPricing['123-5'].min?.price).toBe(280);
    });
    it('сохранение настроек не запускает отправку цен', async () => {
        const store = priceStore();
        store.prices = [price()];
        vi.mocked(axios.post).mockResolvedValue({ data: null });
        await store.saveSettings(0);
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith(
            '/api/good/percent',
            {},
            { params: expect.objectContaining({ offer_id: '123-5', packing_price: 3, available_price: 0 }) },
        );
        expect(axios.get).not.toHaveBeenCalled();
        expect(store.savedSettings['123-5']).toBeTruthy();
    });
    it('первая загрузка передаёт сохранённые входы в расчёт и не вызывает старую выплату', async () => {
        const store = priceStore();
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: { data: [price()] } })
            .mockResolvedValueOnce({ data: result() });
        await store.get();
        expect(axios.get).toHaveBeenLastCalledWith('/api/price/ozon-pricing/123-5', {
            params: expect.objectContaining({ min_perc: 20, sum_pack: 3 }),
        });
        expect(axios.post).not.toHaveBeenCalled();
    });
    it('загрузка текущих цен сохраняет правки настроек', async () => {
        const store = priceStore();
        store.prices = [price()];
        store.prices[0].perc = 50;
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: { data: [{ ...price(), price: 777, perc: 40 }] } })
            .mockResolvedValueOnce({ data: result() });
        await store.reloadCurrent(0);
        expect(store.prices[0]).toMatchObject({ price: 777, perc: 50 });
        expect(axios.post).not.toHaveBeenCalled();
    });
    it('ошибка API заменяет устаревшую цену сообщением, фон не выбрасывает исключение', async () => {
        const store = priceStore();
        store.ozonPricing['123-5'] = result();
        vi.mocked(axios.get).mockRejectedValue(new Error('Нет связи'));
        await expect(store.loadOzonPricing('123-5')).resolves.toBeUndefined();
        expect(store.ozonPricing['123-5']).toMatchObject({ error: 'Нет связи', min: null, normal: null, max: null });
        expect(store.ozonPricingLoading['123-5']).toBe(false);
    });
    it('более поздний ответ старого запроса не перезаписывает новый расчёт', async () => {
        const store = priceStore();
        const old = deferred<{ data: OzonPricingResultDto }>();
        vi.mocked(axios.get)
            .mockReturnValueOnce(old.promise)
            .mockResolvedValueOnce({ data: result(280) });
        const pending = store.loadOzonPricing('123-5');
        await store.loadOzonPricing('123-5');
        old.resolve({ data: result(229) });
        await pending;
        expect(store.ozonPricing['123-5'].min?.price).toBe(280);
    });
    it('основной список загружается, пока новый расчёт ещё ожидается', async () => {
        const store = priceStore();
        const pending = deferred<{ data: OzonPricingResultDto }>();
        vi.mocked(axios.get)
            .mockResolvedValueOnce({ data: { data: [price()] } })
            .mockReturnValueOnce(pending.promise);
        vi.mocked(axios.post).mockResolvedValue({ data: [] });
        await store.get();
        expect(store.prices).toHaveLength(1);
        expect(store.isLoadingPrices).toBe(false);
        expect(store.ozonPricingLoading['123-5']).toBe(true);
        pending.resolve({ data: result() });
        await vi.waitFor(() => expect(store.ozonPricingLoading['123-5']).toBe(false));
    });
    it('ответ от предыдущего списка не попадает в новый список', async () => {
        const store = priceStore();
        const old = deferred<{ data: OzonPricingResultDto }>();
        vi.mocked(axios.get)
            .mockReturnValueOnce(old.promise)
            .mockResolvedValueOnce({ data: { data: [] } });
        const pending = store.loadOzonPricing('123-5');
        await store.get();
        old.resolve({ data: result() });
        await pending;
        expect(store.ozonPricing).toEqual({});
        expect(store.ozonPricingLoading).toEqual({});
    });
});
