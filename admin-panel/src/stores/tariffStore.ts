import { defineStore } from 'pinia'
import axios from "../axios.config";

export const tariffStore = defineStore('tariffStore', {
    state: () => ({
        tariffs: {
            perc_min: 0,
            perc_nor: 0,
            perc_max: 0,
            perc_ekv: 0,
            perc_mil: 0,
            min_mil: 0,
            sum_obtain: 0,
            sum_pack: 0,
            sum_label: 0,
            tax_unit: 0,
            min_perc: 15,
            min_price: 15,
        },
        isLoading: false,
    }),
    actions: {
        async get(){
            this.isLoading = true;
            const res = await axios.get('/api/price/preset');
            this.tariffs = {
                ...this.tariffs,  // Сохраняем старые значения
                ...res.data       // Перезаписываем пришедшими данными
            };
            this.isLoading = false;
        }
    }
})