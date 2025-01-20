import { defineStore } from 'pinia';
import axios from "../axios.config";
import  { GoodServiceEnum } from "@/stores/goods";

export interface SupplyDto {
    id: string;              // Уникальный идентификатор
    remark: string;          // Примечание
    goodService: GoodServiceEnum; // Тип услуги/товара
    isMarketplace: boolean;  // Признак маркетплейса
}

export interface SupplyOrderDto {
    supplyId: string;
    barCode: string;
    remark: string;
    quantity: number;
}

interface SupplyState {
    supplies: SupplyDto[];
    supplyOrders: SupplyOrderDto[];
    isLoading: boolean;
    error: string | null;
}

export const useSupplyStore = defineStore('supply', {
    state: (): SupplyState => ({
        supplies: [] as SupplyDto[],
        supplyOrders: [] as SupplyOrderDto[],
        isLoading: false,
        error: null,
    }),

    getters: {
        wbSupplies: (state) => {
            return state.supplies.filter(supply => supply.goodService === GoodServiceEnum.WB);
        },
    },

    actions: {
        async fetchSupplyOrders(id: string) {
            this.isLoading = true;
            this.error = null;

            try {
                const response = await axios.get<SupplyOrderDto[]>(`/api/supply/orders/${id}`);
                this.supplyOrders = response.data;

            } catch (error: any) {
                this.error = `Ошибка при загрузке списка заказа поставки ${id}`;
                console.error(error);
            } finally {
                this.isLoading = false;
            }
        },
        async fetchSupplies() {
            this.isLoading = true;
            this.error = null;

            try {
                const response = await axios.get<SupplyDto[]>('/api/supply/list');
                this.supplies = response.data;

            } catch (error: any) {
                this.error = 'Ошибка при загрузке списка поставок';
                console.error(error);
            } finally {
                this.isLoading = false;
            }
        },
    },
});