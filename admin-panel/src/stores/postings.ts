import { defineStore } from "pinia";
import type { PostingDto } from "@/contracts/posting.dto";
import axios from "@/axios.config";

// const url = import.meta.env.VITE_URL;

export const postingStore = defineStore("postingStore", {
    state: () => ({
        awaitingDelivery: [] as PostingDto[],
        isLoadingAwaitingDelivery: false,
    }),
    actions: {
        async getAwaitingDelivery(): Promise<void> {
            this.isLoadingAwaitingDelivery = true;
            try {
                const res = await axios.get("/api/order/awaiting-packaging/ozon");
                this.awaitingDelivery = res.data;
            } catch (e: any) {
                console.error(e.message);
            }
            this.isLoadingAwaitingDelivery = false;
        },

        clearAwaitingDelivery(): void {
            this.awaitingDelivery = [];
        },
    }
});