import { defineStore } from "pinia";
import axios from "../axios.config";
import { articulesStore } from "@/stores/articules";
import { tariffStore } from "@/stores/tariffStore";
import type { PriceDto } from "@/contracts/price.dto";

// const url = import.meta.env.VITE_URL;

export const priceStore = defineStore("priceStore", {
    state: () => ({
        prices: [] as PriceDto[],
        pays: [] as string[][],
        isLoadingPrices: false,
        isLoadingPrice: [] as boolean[],
        successSave: false,
        failSave: false,
        failMessage: '' as string,
    }),
    actions: {
        async get(): Promise<void> {
            this.isLoadingPrices = true;
            this.prices = [];
            this.pays = [];
            this.isLoadingPrice = [];
            const res = await axios.get("/api/price", {
                params: { offer_id: articulesStore().articules, limit: articulesStore().articules.length }
            });
            const prices: PriceDto[] = res.data.data;
            const { tariffs } = tariffStore();
            for (const price of prices) {
                this.pays.push(
                    (await axios.post("/api/price/calculate-pay", {
                        price,
                        percents: {
                            minMil: tariffs.min_mil,
                            percMil: tariffs.perc_mil,
                            percEkv: tariffs.perc_ekv,
                            sumObtain: tariffs.sum_obtain,
                            sumLabel: tariffs.sum_label,
                            taxUnit: tariffs.tax_unit,
                        },
                        sums: [price.marketing_seller_price, price.old_price, price.price, price.min_price]
                    })).data
                );
                this.isLoadingPrice.push(false);
            }
            this.$patch({ prices });
            this.isLoadingPrices = false;
        },
        async getInd(index: number): Promise<void> {
            this.isLoadingPrice[index] = true;
            const price = this.prices[index];
            const { tariffs } = tariffStore();
            let res = await axios.post( "/api/price/calculate", {
                    price,
                    percents: {
                        minMil: tariffs.min_mil,
                        percMil: tariffs.perc_mil,
                        percEkv: tariffs.perc_ekv,
                        sumObtain: tariffs.sum_obtain,
                        sumLabel: tariffs.sum_label,
                        taxUnit: tariffs.tax_unit,
                    }
                });
            const { min_price, price: newPrice, old_price } = res.data;
            this.prices[index] = {
                ...this.prices[index],
                min_price,
                price: newPrice,
                old_price
            };
            res = await axios.post('/api/price/calculate-pay', {
                price,
                percents: {
                    minMil: tariffs.min_mil,
                    percMil: tariffs.perc_mil,
                    percEkv: tariffs.perc_ekv,
                    sumObtain: tariffs.sum_obtain,
                    sumLabel: tariffs.sum_label,
                    taxUnit: tariffs.tax_unit,
                },
                sums: [price.marketing_seller_price, price.old_price, price.price, price.min_price]
            })
            this.pays[index] = res.data;
            this.isLoadingPrice[index] = false;
        },
        async calculatePercents(index: number): Promise<void> {
            this.isLoadingPrice[index] = true;
            const price = this.prices[index];
            try {
                const res = await axios.post(
                    `/api/price/calculate-percents/${price.offer_id}`, 
                    {
                        adv_perc: price.adv_perc,
                        packing_price: price.sum_pack,
                        available_price: price.available_price
                    }
                );
                const { offer_id, ...data } = res.data;
                this.prices[index] = { ...this.prices[index], ...data };
                await this.getInd(index);
            } catch (e: any) {
                this.failMessage = e.message;
                this.failSave = true;
            }
            this.isLoadingPrice[index] = false;
        },
    
        async save(index: number, edit: boolean): Promise<void> {
            this.isLoadingPrice[index] = true;
            this.successSave = false;
            this.failSave = false;
            this.failMessage = '';
            const {
                offer_id,
                min_perc,
                perc,
                old_perc,
                adv_perc,
                sum_pack,
                incoming_price,
                available_price,
            } = this.prices[index];
            try {
                await axios.post('/api/good/percent', {}, {
                    params: {
                        offer_id, min_perc, perc, old_perc, adv_perc, packing_price: sum_pack, available_price,
                    }
                });
                const res = await axios.post<any[]>('/api/price', {
                    prices: [{ offer_id, min_price: '0', price: '0', old_price: '0', incoming_price: edit ? available_price : 0 }]
                });
                if (!res.data?.[0]?.result?.[0]?.updated) {
                    throw new Error(res.data?.[0]?.result?.[0]?.errors?.toString() || 'Unknown error in first response');
                }
                if (res.data?.[1]?.offerUpdate?.status !== 'OK') {
                    throw new Error(res.data?.[1]?.toString() || 'Unknown error in second response');
                }
                if (res.data?.[2]?.status === 'NotOk') {
                    throw new Error(res.data?.[2]?.error?.service_message || res.data?.[2]?.error?.message || 'Unknown error in third response');
                }
                this.successSave = true;
            } catch (e: any) {
                if (e.response?.data?.message) {
                    this.failMessage = e.response.data.message;
                } else {
                    this.failMessage = e.message;
                }
                this.failSave = true;
            }
            this.isLoadingPrice[index] = false;
        }
    }
});