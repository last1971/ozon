import { defineStore } from "pinia";
import axios from "../axios.config";
import { articulesStore } from "@/stores/articules";
import { tariffStore } from "@/stores/tariffStore";
import type { PriceDto } from "@/contracts/price.dto";

const url = import.meta.env.VITE_URL;

export const priceStore = defineStore("priceStore", {
    state: () => ({
        prices: [] as PriceDto[],
        pays: [] as string[][]
    }),
    actions: {
        async get(): Promise<void> {
            console.log(url);
            const res = await axios.get("/api/price", {
                params: { offer_id: articulesStore().articules, limit: articulesStore().articules.length }
            });
            const prices: PriceDto[] = res.data.data;
            const { tariffs } = tariffStore();
            this.pays = [];
            for (const price of prices) {
                this.pays.push(
                    (await axios.post("/api/price/calculate-pay", {
                        price,
                        percents: {
                            minMil: tariffs.min_mil,
                            percMil: tariffs.perc_mil,
                            percEkv: tariffs.perc_ekv,
                            sumObtain: tariffs.sum_obtain,
                            sumLabel: tariffs.sum_label
                        },
                        sums: [price.marketing_seller_price, price.old_price, price.price, price.min_price]
                    })).data
                );
            }
            this.$patch({ prices });
        },
        async getInd(index: number): Promise<void> {
            const price = this.prices[index];
            const { tariffs } = tariffStore();
            let res = await axios.post( "/api/price/calculate", {
                    price,
                    percents: {
                        minMil: tariffs.min_mil,
                        percMil: tariffs.perc_mil,
                        percEkv: tariffs.perc_ekv,
                        sumObtain: tariffs.sum_obtain,
                        sumLabel: tariffs.sum_label
                    }
                });
            price.min_price = res.data.min_price;
            price.price = res.data.price;
            price.old_price = res.data.old_price;
            res = await axios.post('/api/price/calculate-pay', {
                price,
                percents: {
                    minMil: tariffs.min_mil,
                    percMil: tariffs.perc_mil,
                    percEkv: tariffs.perc_ekv,
                    sumObtain: tariffs.sum_obtain,
                    sumLabel: tariffs.sum_label,
                },
                sums: [price.marketing_seller_price, price.old_price, price.price, price.min_price]
            })
            this.pays[index] = res.data;
        },
        async save(index: number): Promise<void> {
            const {
                offer_id,
                min_perc,
                perc,
                old_perc,
                adv_perc,
                sum_pack,
            } = this.prices[index];
            await axios.post('/api/good/percent', {},{ params: {
                offer_id, min_perc, perc, old_perc, adv_perc, packing_price: sum_pack,
            }});
            await axios.post('/api/price', {
                prices:[{ offer_id, min_price: '0', price: '0', old_price: '0'}]
            });
        }
    }
});