import { defineStore } from "pinia";
import type { GoodInfoDto } from "@/contracts/good.info.dto";
import axios from "@/axios.config";

export enum GoodServiceEnum {
    OZON = 'ozon',
    YANDEX = 'yandex',
    EXPRESS = 'express',
    WB = 'wb',
}

// const url = import.meta.env.VITE_URL;

export const goodStore = defineStore('goodStore', {
    state: () => ({
        goodInfos:  new Map<GoodServiceEnum, GoodInfoDto[]>(Object.values(GoodServiceEnum).map((key) => [key, []])),
        isLoadingGoodInfos: false,
    }),
    actions: {
        async getGoodInfoBySkus(skus: string[], service: GoodServiceEnum) {
            this.isLoadingGoodInfos = true;
            try {
                const res = await axios.post(`/api/good/info/${service}`, { skus });
                const updatedData: GoodInfoDto[] = Array.from(new Set([...(this.goodInfos.get(service) || []), ...res.data]));
                this.goodInfos.set(service, updatedData);
            } catch (e: any) {
                console.error(e.message);
            }
            this.isLoadingGoodInfos = false;
        }
    }
})