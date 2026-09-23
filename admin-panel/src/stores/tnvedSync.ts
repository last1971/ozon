import { defineStore } from "pinia";
import axios from "../axios.config";
import { GoodServiceEnum } from "@/stores/goods";

/** Решение маркетплейса по карточке (см. src/interfaces/i.tnved.updateable.ts на бэке) + итог записи. */
export interface TnvedFixItem {
    offer: string;
    goodscode: string;
    name?: string;
    current: string | null;
    base: string;
    markRequired: boolean;
    reason?: string;
    action?: string;
    taskId?: number;
    error?: string;
}

export interface TnvedSyncReport {
    apply: boolean;
    checkedGoods: number;
    checkedOffers: number;
    toFix: TnvedFixItem[];
    alreadyOk: number;
    notFoundOnOzon: string[];
    ambiguous: { offer: string; reason: string }[];
    skippedProcessed: number; // пропущено как уже обработанные (onlyNew)
    remaining: number; // товаров базы ещё не обработано
}

export const tnvedSyncStore = defineStore("tnvedSyncStore", {
    state: () => ({
        form: {
            market: GoodServiceEnum.OZON,
            offer: '', // один goodscode (обкатка), пусто = вся база
            limit: null as number | null, // первые N товаров базы, пусто = все
            onlyNew: true, // пропускать уже обработанные: limit = «следующие N», массово — «Проверить» → «Записать» порциями
        },
        report: null as TnvedSyncReport | null,
        isLoading: false,
        errorMessage: '',
    }),
    getters: {
        /** Записывать можно только после проверки того же маркетплейса, и только если есть что править. */
        canWrite: (state) => !!state.report && !state.report.apply && state.report.toFix.length > 0,
    },
    actions: {
        /** apply=false — только отчёт; apply=true — записать на маркетплейс. */
        async run(apply: boolean) {
            this.errorMessage = '';
            this.isLoading = true;
            try {
                const params: Record<string, string | number | boolean> = { market: this.form.market, apply, onlyNew: this.form.onlyNew };
                if (this.form.offer.trim()) params.offer = this.form.offer.trim();
                if (this.form.limit && this.form.limit > 0) params.limit = this.form.limit;
                const res = await axios.post("/api/tnved-sync", null, { params });
                this.report = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isLoading = false;
            }
        },
        check() {
            return this.run(false);
        },
        write() {
            return this.run(true);
        },
        /** Сбросить прогресс раскатки по маркетплейсу — следующий прогон «только необработанные» пойдёт с нуля. */
        async resetProgress() {
            this.errorMessage = '';
            this.isLoading = true;
            try {
                await axios.delete("/api/tnved-sync/progress", { params: { market: this.form.market } });
                this.report = null;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isLoading = false;
            }
        },
        clear() {
            this.report = null;
            this.errorMessage = '';
        },
    },
});
