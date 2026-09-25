import { defineStore } from "pinia";
import axios from "../axios.config";
import { GoodServiceEnum } from "@/stores/goods";
import type { JobState } from "@/contracts/job.state";

export const DICT_CATEGORIES_JOB = 'dict-categories';
export const DICT_TNVED_JOB = 'dict-tnved';

/** Отчёт задач справочника (см. src/interfaces/i.tnved.dictionary.ts на бэке). */
export interface DictReport {
    market: string;
    categories?: number;
    subjects?: number;
    saved?: number;
    empty?: number;
    failed?: number;
    codes?: number;
}

export interface DictStats {
    market: string;
    subjects: number;
    withTnved: number;
    stale: number;
}

export interface DictSubjectHit {
    id: number;
    name: string;
    parentName: string;
    commission: number | null;
    isKiz: boolean;
}

export type TnvedMatch = 'exact' | 'prefix6' | 'prefix4' | 'none';

export interface TnvedLookup {
    market: string;
    tnved: string;
    match: TnvedMatch;
    subjects: DictSubjectHit[];
}

/** Вкладка «Справочники МП»: обновление по выбранному рынку (ход — useJob по виду), поиск по всем рынкам сразу. */
export const dictStore = defineStore("dictStore", {
    state: () => ({
        form: {
            market: GoodServiceEnum.OZON,
            all: false, // ТН ВЭД: качать все предметы заново, а не только новые и устаревшие
        },
        stats: [] as DictStats[],
        tnved: '',
        lookup: [] as TnvedLookup[],
        isSearching: false,
        errorMessage: '',
    }),
    actions: {
        async startCategories(): Promise<JobState<DictReport>> {
            const res = await axios.post<JobState<DictReport>>("/api/dict/categories", null, { params: { market: this.form.market } });
            return res.data;
        },
        async startTnved(): Promise<JobState<DictReport>> {
            const res = await axios.post<JobState<DictReport>>("/api/dict/tnved", null, { params: { market: this.form.market, all: this.form.all } });
            return res.data;
        },
        async loadStats() {
            try {
                const res = await axios.get<DictStats[]>("/api/dict/stats");
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
                const res = await axios.get<TnvedLookup[]>("/api/dict/subjects", { params: { tnved: code } });
                this.lookup = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isSearching = false;
            }
        },
    },
});
