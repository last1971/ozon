import { defineStore } from 'pinia'
import axios from "../axios.config";
import { th } from "vuetify/locale";

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
        },
        isLoading: false,
    }),
    actions: {
        async get(){
            this.isLoading = true;
            const res = await axios.get('/api/price/preset');
            this.tariffs = res.data;
            this.isLoading = false;
        }
    }
})