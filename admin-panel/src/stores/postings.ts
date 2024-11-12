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
                this.awaitingDelivery = res.data.sort((a: any, b: any) => {
                    // Сортировка по первой дате
                    const date1Comparison =
                        new Date(a.shipment_date).getTime() - new Date(b.shipment_date).getTime();
                    if (date1Comparison !== 0) return date1Comparison;

                    // Если первая дата равна, сортируем по второй дате
                    return new Date(a.in_process_at).getTime() - new Date(b.in_process_at).getTime();
                });
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