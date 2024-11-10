import { defineStore } from "pinia";
import type { GoodInfoDto } from "@/contracts/good.info.dto";
import axios from "@/axios.config";

// const url = import.meta.env.VITE_URL;

export const goodStore = defineStore('goodStore', {
    state: () => ({
        goodInfos: [] as GoodInfoDto[],
        isLoadingGoodInfos: false,
    }),
    actions: {
        async getGoodInfoBySkus(skus: string[]) {
            this.isLoadingGoodInfos = true;
            try {
                const res = await axios.post(`/api/good/info`, { skus });
                this.goodInfos = res.data;
            } catch (e: any) {
                console.error(e.message);
            }
            this.isLoadingGoodInfos = false;
        }
    }
})