import { defineStore } from "pinia";
import axios from "../axios.config";
import { GoodServiceEnum } from "@/stores/goods";
import type { JobState } from "@/contracts/job.state";

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

export const TNVED_SYNC_JOB = 'tnved-sync';
export const TNVED_MISSING_JOB = 'tnved-missing';

/** Карточка маркетплейса, у которой у нас ТН ВЭД пуст или товара нет. */
export interface TnvedMarketOffer {
    offer: string;
    goodscode: string;
    name?: string;
}

export interface MissingTnvedReport {
    market: string;
    offers: number;
    noTnved: TnvedMarketOffer[]; // товар в базе есть, ТН ВЭД пуст — заполнять у нас
    notInBase: TnvedMarketOffer[]; // кода у нас нет вообще — привязка карточки
}

/** Форма вкладки ТН ВЭД и вызовы бэка; ход и отчёт задачи живут в useJob(TNVED_SYNC_JOB). */
export const tnvedSyncStore = defineStore("tnvedSyncStore", {
    state: () => ({
        form: {
            market: GoodServiceEnum.OZON,
            offer: '', // один goodscode (обкатка), пусто = вся база
            limit: null as number | null, // следующие N товаров базы, пусто = все
            onlyNew: true, // пропускать уже обработанные: массово — «Проверить» → «Записать» порциями
        },
        isResetting: false,
        errorMessage: '',
    }),
    actions: {
        /** Старт фоновой задачи: apply=false — только отчёт; apply=true — записать на маркетплейс. */
        async start(apply: boolean): Promise<JobState<TnvedSyncReport>> {
            const params: Record<string, string | number | boolean> = { market: this.form.market, apply, onlyNew: this.form.onlyNew };
            if (this.form.offer.trim()) params.offer = this.form.offer.trim();
            if (this.form.limit && this.form.limit > 0) params.limit = this.form.limit;
            const res = await axios.post<JobState<TnvedSyncReport>>("/api/tnved-sync", null, { params });
            return res.data;
        },
        /** «Где у нас пусто»: каталог маркетплейса минус товары с ТН ВЭД. Фоном. */
        async startMissing(): Promise<JobState<MissingTnvedReport>> {
            const res = await axios.post<JobState<MissingTnvedReport>>("/api/tnved-sync/missing", null, { params: { market: this.form.market } });
            return res.data;
        },
        /** Сбросить прогресс раскатки по маркетплейсу — следующий прогон «только необработанные» пойдёт с нуля. */
        async resetProgress() {
            this.errorMessage = '';
            this.isResetting = true;
            try {
                await axios.delete("/api/tnved-sync/progress", { params: { market: this.form.market } });
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isResetting = false;
            }
        },
    },
});
