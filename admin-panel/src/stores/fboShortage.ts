import { defineStore } from "pinia";
import axios from "../axios.config";

/** Зеркало src/invoice/dto/invoice-donors.dto.ts и src/posting.fbo/dto/fbo-shortage-apply.dto.ts на бэке. */
export interface DonorRow {
    invoiceNumber: number;
    scode: number;
    date: string | null;
    prim: string | null;
    podbposcode: number;
    realpricecode: number;
    quantity: number;
    codesLive?: number;
    codesNominal?: number;
    codesDead?: number;
    canTake?: boolean;
    reason?: string;
}

export interface DonorLine {
    realpricecode: number;
    goodscode: string;
    name: string | null;
    quantity: number;
    pieces: number | null;
    picked: number;
    shortage: number;
    inShortage: boolean;
    donors: DonorRow[];
}

export interface InvoiceDonors {
    invoiceNumber: number;
    scode: number;
    status: number;
    date: string | null;
    prim: string | null;
    buyerCode: number;
    inShortage: boolean;
    lines: DonorLine[];
}

export interface ShortageRow {
    service: string;
    posting: string;
    invoiceNumber: number;
    scode: number;
    realpricecode: number;
    goodscode: string;
    name: string | null;
    quantity: number;
    picked: number;
    shortage: number;
    prim: string | null;
    date: string | null;
}

export interface ApplyResult {
    posting: string;
    scode: number;
    moved: { realpricecode: number; goodscode: string; donorInvoiceNumber: number; quantity: number; codes: string[] }[];
    shortageClosed: boolean;
    pickedUp: boolean;
}

/** Ключ выбора: строка приёмника + подборка донора. */
export const pickKey = (realpricecode: number, podbposcode: number) => `${realpricecode}:${podbposcode}`;

/**
 * Вкладка «Недобор FBO»: журнал открытых недоборов, предложение доноров по отправлению,
 * выбор «сколько с какого счёта» и отправка. Сумма по строке должна сойтись ровно —
 * ту же проверку делает бэк, здесь только подсветка.
 */
export const fboShortageStore = defineStore("fboShortageStore", {
    state: () => ({
        shortages: [] as ShortageRow[],
        posting: '',
        offers: [] as InvoiceDonors[],
        scode: null as number | null,
        picks: {} as Record<string, number>, // pickKey → сколько взять
        nominals: {} as Record<string, number>, // realpricecode → номинал для строк без фасовки
        result: null as ApplyResult | null,
        isLoading: false,
        isApplying: false,
        errorMessage: '',
    }),
    getters: {
        offer(state): InvoiceDonors | null {
            return state.offers.find((o) => o.scode === state.scode) ?? null;
        },
        /** Взято по строке приёмника. */
        takenByLine(state): Record<number, number> {
            const sum: Record<number, number> = {};
            for (const [key, qty] of Object.entries(state.picks)) {
                const rpc = Number(key.split(':')[0]);
                sum[rpc] = (sum[rpc] ?? 0) + (Number(qty) || 0);
            }
            return sum;
        },
        /** Взято с донора суммарно по всем строкам. */
        takenByDonor(state): Record<number, number> {
            const sum: Record<number, number> = {};
            for (const [key, qty] of Object.entries(state.picks)) {
                const podbpos = Number(key.split(':')[1]);
                sum[podbpos] = (sum[podbpos] ?? 0) + (Number(qty) || 0);
            }
            return sum;
        },
        /** Строки, которые тронули, сходятся ровно; хотя бы одна тронута. */
        canApply(): boolean {
            const offer = this.offer as InvoiceDonors | null;
            if (!offer) return false;
            const taken = this.takenByLine as Record<number, number>;
            const touched = offer.lines.filter((l) => (taken[l.realpricecode] ?? 0) > 0);
            if (!touched.length) return false;
            return touched.every((l) => {
                const nominal = l.pieces ?? Number((this.nominals as Record<string, number>)[String(l.realpricecode)] ?? 0);
                return taken[l.realpricecode] === l.shortage && nominal > 0;
            });
        },
    },
    actions: {
        async loadShortages() {
            try {
                const res = await axios.get<ShortageRow[]>("/api/fbo-shortage");
                this.shortages = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            }
        },
        async loadOffer() {
            const posting = this.posting.trim();
            if (!posting) return;
            this.errorMessage = '';
            this.result = null;
            this.picks = {};
            this.isLoading = true;
            try {
                const res = await axios.get<InvoiceDonors[]>(`/api/invoice/donors/${encodeURIComponent(posting)}`);
                this.offers = res.data;
                this.scode = res.data.find((o) => o.inShortage)?.scode ?? res.data[0]?.scode ?? null;
                if (!res.data.length) this.errorMessage = `счёт по отправлению ${posting} не найден`;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isLoading = false;
            }
        },
        setPick(realpricecode: number, podbposcode: number, quantity: number | null) {
            const key = pickKey(realpricecode, podbposcode);
            if (!quantity || quantity <= 0) delete this.picks[key];
            else this.picks[key] = Math.floor(quantity);
        },
        async apply() {
            const offer = this.offer;
            if (!offer) return;
            const picks = Object.entries(this.picks).map(([key, quantity]) => {
                const [realpricecode, podbposcode] = key.split(':').map(Number);
                return { realpricecode, podbposcode, quantity };
            });
            this.errorMessage = '';
            this.isApplying = true;
            try {
                const res = await axios.post<ApplyResult>(`/api/fbo-shortage/${encodeURIComponent(this.posting.trim())}/apply`, {
                    scode: offer.scode,
                    picks,
                    nominals: this.nominals,
                });
                this.result = res.data;
                this.picks = {};
                await Promise.all([this.loadShortages(), this.loadOffer()]);
                this.result = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isApplying = false;
            }
        },
    },
});
