import { defineStore } from "pinia";
import axios from "../axios.config";
import { GoodServiceEnum } from "@/stores/goods";
import type { JobState } from "@/contracts/job.state";

/** Что сверяем с карточками (см. src/interfaces/i.card.sync.ts на бэке). */
export type SyncMode = 'tnved' | 'gtin';

/**
 * Решение маркетплейса по карточке + итог записи. current — что на карточке, base — что по базе
 * (ТН ВЭД: код; GTIN: баркоды карточки / наши GTIN). markRequired — только у ТН ВЭД, add — только у GTIN.
 */
export interface TnvedFixItem {
    offer: string;
    goodscode: string;
    name?: string;
    current: string | null;
    base: string;
    markRequired?: boolean;
    add?: string[];
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
    forFile?: number; // карточек для файла в кабинете (Озон: GTIN фасовок — кнопка «Файл для Озона»)
}

export const TNVED_SYNC_JOB = 'tnved-sync';
export const TNVED_MISSING_JOB = 'tnved-missing';
export const GTIN_SYNC_JOB = 'gtin-sync';

/** Вид фоновой задачи режима: у режимов свои задачи, идут независимо. */
export const syncJobKind = (mode: SyncMode) => (mode === 'gtin' ? GTIN_SYNC_JOB : TNVED_SYNC_JOB);

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

/** Форма вкладки сверки карточек (ТН ВЭД / GTIN) и вызовы бэка; ход и отчёт задачи живут в useJob(syncJobKind(mode)). */
export const tnvedSyncStore = defineStore("tnvedSyncStore", {
    state: () => ({
        form: {
            mode: 'tnved' as SyncMode,
            market: GoodServiceEnum.OZON,
            offer: '', // один goodscode (обкатка), пусто = вся база
            limit: null as number | null, // следующие N товаров базы, пусто = все
            onlyNew: true, // пропускать уже обработанные: массово — «Проверить» → «Записать» порциями
        },
        isResetting: false,
        isDownloading: false,
        errorMessage: '',
    }),
    actions: {
        /** Старт фоновой задачи: apply=false — только отчёт; apply=true — записать на маркетплейс. */
        async start(apply: boolean): Promise<JobState<TnvedSyncReport>> {
            const params: Record<string, string | number | boolean> = { mode: this.form.mode, market: this.form.market, apply, onlyNew: this.form.onlyNew };
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
        /**
         * «Файл для Озона»: xlsx по шаблону кабинета «Шаблон для загрузки GTIN» — фасовки, которым GTIN через API
         * не положить. Бэк сверяет всю базу, файл сразу скачивается; грузится руками в кабинете Озона.
         */
        async downloadOzonGtinFile() {
            this.errorMessage = '';
            this.isDownloading = true;
            try {
                const res = await axios.get("/api/tnved-sync/gtin-file", { params: { market: this.form.market }, responseType: 'blob' });
                const name = /filename=([^;]+)/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? 'ozon-gtin.xlsx';
                const link = document.createElement('a');
                link.href = URL.createObjectURL(res.data);
                link.download = name;
                link.click();
                URL.revokeObjectURL(link.href);
                return Number(res.headers['x-rows'] ?? 0);
            } catch (e: any) {
                const blob: Blob | undefined = e.response?.data instanceof Blob ? e.response.data : undefined;
                const text = blob ? JSON.parse(await blob.text())?.message : e.response?.data?.message;
                this.errorMessage = text || e.message;
                return 0;
            } finally {
                this.isDownloading = false;
            }
        },
        /** Сбросить прогресс раскатки режима по маркетплейсу — следующий прогон «только необработанные» пойдёт с нуля. */
        async resetProgress() {
            this.errorMessage = '';
            this.isResetting = true;
            try {
                await axios.delete("/api/tnved-sync/progress", { params: { market: this.form.market, mode: this.form.mode } });
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isResetting = false;
            }
        },
    },
});
