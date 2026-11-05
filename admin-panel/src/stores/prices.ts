import { defineStore } from 'pinia';
import axios from '../axios.config';
import { articulesStore } from '@/stores/articules';
import type { PriceDto } from '@/contracts/price.dto';
import type { PayResultDto } from '@/contracts/pay.result.dto';
import type { OzonPricingResultDto } from '@/contracts/ozon-pricing-result.dto';

/** Только редактируемые настройки товара; расходы и ограничения задаёт сервер. */
export const priceSettings = (p: PriceDto) => ({
    offer_id: p.offer_id,
    min_perc: Number(p.min_perc),
    perc: Number(p.perc),
    old_perc: Number(p.old_perc),
    adv_perc: Number(p.adv_perc),
    sum_pack: Number(p.sum_pack),
    available_price: Number(p.available_price),
});
export const priceSettingsKey = (p: PriceDto) => JSON.stringify(priceSettings(p));

export const priceStore = defineStore('priceStore', {
    state: () => ({
        prices: [] as PriceDto[],
        savedSettings: {} as Record<string, string>,
        ozonPricing: {} as Record<string, OzonPricingResultDto>,
        ozonPricingLoading: {} as Record<string, boolean>,
        ozonPricingRequests: {} as Record<string, number>,
        ozonPricingEpoch: 0,
        pays: [] as PayResultDto[][],
        isLoadingPrices: false,
        isLoadingPrice: [] as boolean[],
        successSave: false,
        failSave: false,
        failMessage: '' as string,
    }),
    actions: {
        async loadOzonPricing(offerId: string): Promise<void> {
            const epoch = this.ozonPricingEpoch;
            const request = (this.ozonPricingRequests[offerId] ?? 0) + 1;
            this.ozonPricingRequests[offerId] = request;
            this.ozonPricingLoading[offerId] = true;
            const isCurrent = () => epoch === this.ozonPricingEpoch && request === this.ozonPricingRequests[offerId];
            const price = this.prices.find((p) => p.offer_id === offerId);
            const params = price
                ? {
                      min_perc: price.min_perc,
                      perc: price.perc,
                      old_perc: price.old_perc,
                      adv_perc: price.adv_perc,
                      sum_pack: price.sum_pack,
                      available_price: price.available_price,
                  }
                : undefined;
            try {
                const { data } = await axios.get<OzonPricingResultDto>(
                    `/api/price/ozon-pricing/${encodeURIComponent(offerId)}`,
                    { params },
                );
                if (isCurrent()) this.ozonPricing[offerId] = data;
            } catch (e: any) {
                if (isCurrent())
                    this.ozonPricing[offerId] = {
                        offerId,
                        baseSource: 'none',
                        base: 0,
                        min: null,
                        normal: null,
                        max: null,
                        costs: null,
                        current: null,
                        error: e.response?.data?.message?.toString() || e.message || 'Не удалось получить расчёт Ozon',
                    };
            } finally {
                if (isCurrent()) this.ozonPricingLoading[offerId] = false;
            }
        },

        async get(): Promise<void> {
            this.isLoadingPrices = true;
            this.ozonPricingEpoch++;
            this.ozonPricing = {};
            this.ozonPricingLoading = {};
            this.ozonPricingRequests = {};
            this.savedSettings = {};
            this.prices = [];
            this.pays = [];
            this.isLoadingPrice = [];
            try {
                const res = await axios.get('/api/price', {
                    params: { offer_id: articulesStore().articules, limit: articulesStore().articules.length },
                });
                this.prices = res.data.data;
                for (const price of this.prices) {
                    this.savedSettings[price.offer_id] = priceSettingsKey(price);
                    void this.loadOzonPricing(price.offer_id);
                }
            } finally {
                this.isLoadingPrices = false;
            }
        },
        async getInd(index: number): Promise<void> {
            await this.loadOzonPricing(this.prices[index].offer_id);
        },
        async reloadCurrent(index: number): Promise<void> {
            const price = this.prices[index];
            const res = await axios.get('/api/price', { params: { offer_id: [price.offer_id], limit: 1 } });
            const current = res.data.data.find((p: PriceDto) => p.offer_id === price.offer_id);
            if (!current) throw new Error('Товар не найден');
            this.prices[index] = { ...current, ...priceSettings(price) };
            await this.loadOzonPricing(price.offer_id);
        },
        async saveSettings(index: number): Promise<void> {
            const price = this.prices[index],
                settings = priceSettings(price);
            this.isLoadingPrice[index] = true;
            try {
                const { sum_pack, ...params } = settings;
                await axios.post('/api/good/percent', {}, { params: { ...params, packing_price: sum_pack } });
                this.savedSettings[price.offer_id] = JSON.stringify(settings);
            } finally {
                this.isLoadingPrice[index] = false;
            }
        },
        async calculatePercents(index: number): Promise<void> {
            this.isLoadingPrice[index] = true;
            const price = this.prices[index];
            try {
                const res = await axios.post(`/api/price/calculate-percents/${price.offer_id}`, {
                    adv_perc: price.adv_perc,
                    packing_price: price.sum_pack,
                    available_price: price.available_price,
                });
                const { offer_id, ...data } = res.data;
                this.prices[index] = { ...this.prices[index], ...data };
                await this.getInd(index);
            } catch (e: any) {
                this.failMessage = e.message;
                this.failSave = true;
                throw e;
            } finally {
                this.isLoadingPrice[index] = false;
            }
        },
    },
});
