import { defineStore } from "pinia";
import axios from "../axios.config";
import type { JobState } from "@/contracts/job.state";

export const WB_DICT_CATEGORIES_JOB = 'wb-dict-categories';
export const WB_DICT_TNVED_JOB = 'wb-dict-tnved';

/** Отчёт задач справочника (см. src/interfaces/i.wb.dict.context.ts на бэке). */
export interface WbDictReport {
    categories?: number;
    subjects?: number;
    saved?: number;
    empty?: number;
    failed?: number;
    codes?: number;
}

export interface WbDictStats {
    subjects: number;
    withTnved: number;
    stale: number;
}

export interface WbSubjectHit {
    id: number;
    name: string;
    parentName: string;
    commission: number;
    isKiz: boolean;
}

export type WbTnvedMatch = 'exact' | 'prefix6' | 'prefix4' | 'none';

export interface WbTnvedLookup {
    tnved: string;
    match: WbTnvedMatch;
    subjects: WbSubjectHit[];
}

/** Вкладка «Справочник ВБ»: две фоновые задачи (ход — useJob по виду) и поиск предметов по коду ТН ВЭД. */
export const wbDictStore = defineStore("wbDictStore", {
    state: () => ({
        all: false, // ТН ВЭД: качать все предметы заново, а не только новые и устаревшие
        stats: null as WbDictStats | null,
        tnved: '',
        lookup: null as WbTnvedLookup | null,
        isSearching: false,
        errorMessage: '',
    }),
    actions: {
        async startCategories(): Promise<JobState<WbDictReport>> {
            const res = await axios.post<JobState<WbDictReport>>("/api/wb-dict/categories");
            return res.data;
        },
        async startTnved(): Promise<JobState<WbDictReport>> {
            const res = await axios.post<JobState<WbDictReport>>("/api/wb-dict/tnved", null, { params: { all: this.all } });
            return res.data;
        },
        async loadStats() {
            try {
                const res = await axios.get<WbDictStats>("/api/wb-dict/stats");
                this.stats = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            }
        },
        async search() {
            const code = this.tnved.replace(/\D/g, '');
            if (code.length < 4) {
                this.errorMessage = 'Нужно хотя бы 4 знака кода ТН ВЭД';
                return;
            }
            this.errorMessage = '';
            this.isSearching = true;
            try {
                const res = await axios.get<WbTnvedLookup>("/api/wb-dict/subjects", { params: { tnved: code } });
                this.lookup = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isSearching = false;
            }
        },
    },
});
