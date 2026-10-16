import { defineStore } from "pinia";
import axios from "../axios.config";
import type { MpService, ReturnAction, ReturnCard, ReturnRow } from "@/contracts/mp-return.dto";

import { readUser, saveUser } from "./username";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86400000));

/**
 * Вкладка «Возвраты»: список полученных маркетплейсом возвратов, поиск по скану этикетки,
 * карточка со сканом марок и решения. Можно ли — решает бэк (карточка несёт canAccept и причины),
 * здесь только показ и сбор сканов.
 */
export const mpReturnsStore = defineStore("mpReturnsStore", {
    state: () => ({
        service: 'OZON' as MpService,
        from: daysAgo(14),
        to: isoDay(new Date()),
        onlyPending: true,
        rows: [] as ReturnRow[],
        cards: [] as ReturnCard[],
        cardIndex: 0,
        markScans: [] as string[],
        comment: '',
        osnSpisId: 4 as number | null,
        reasons: [] as { id: number; name: string }[],
        username: readUser(),
        isLoading: false,
        isSaving: false,
        errorMessage: '',
        okMessage: '',
    }),
    getters: {
        card(state): ReturnCard | null {
            return state.cards[state.cardIndex] ?? null;
        },
    },
    actions: {
        setUsername(name: string) {
            this.username = name;
            saveUser(name);
        },
        async loadReasons() {
            if (this.reasons.length) return;
            try {
                this.reasons = (await axios.get('/api/mp-return/write-off-reasons')).data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            }
        },
        async loadList() {
            this.isLoading = true;
            try {
                const res = await axios.get<ReturnRow[]>('/api/mp-return', {
                    params: { service: this.service, from: this.from, to: this.to, onlyPending: this.onlyPending },
                });
                this.rows = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isLoading = false;
            }
        },
        async lookup(q: string) {
            const text = q.trim();
            if (!text) return;
            this.errorMessage = '';
            this.okMessage = '';
            this.isLoading = true;
            try {
                const res = await axios.get<ReturnCard[]>('/api/mp-return/lookup', { params: { service: this.service, q: text } });
                this.openCards(res.data);
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isLoading = false;
            }
        },
        openCards(cards: ReturnCard[]) {
            this.cards = cards;
            this.cardIndex = Math.max(0, cards.findIndex((c) => c.canAccept || c.canWriteOff));
            this.resetInput();
        },
        selectCard(i: number) {
            this.cardIndex = i;
            this.resetInput();
        },
        closeCard() {
            this.cards = [];
            this.resetInput();
        },
        resetInput() {
            this.markScans = [];
            this.comment = '';
            const reason = this.card?.line.reason ?? '';
            this.osnSpisId = /брак|поврежд|не работает|дефект|сломан/i.test(reason) ? 4 : this.osnSpisId ?? 4;
        },
        addMarkScan(raw: string) {
            const text = raw.trim();
            if (text && !this.markScans.includes(text)) this.markScans.push(text);
        },
        removeMarkScan(raw: string) {
            this.markScans = this.markScans.filter((s) => s !== raw);
        },
        async act(action: ReturnAction) {
            const card = this.card;
            if (!card) return;
            await this.post(`/api/mp-return/${card.line.service}/${encodeURIComponent(card.line.extId)}/accept`, {
                action,
                username: this.username.trim(),
                scans: this.markScans,
                comment: this.comment.trim() || undefined,
                posting: card.line.posting,
                osnSpisId: action === 'return-writeoff' ? this.osnSpisId : undefined,
            });
        },
        async writeOff() {
            const card = this.card;
            if (!card) return;
            await this.post(`/api/mp-return/${card.line.service}/${encodeURIComponent(card.line.extId)}/write-off`, {
                username: this.username.trim(),
                osnSpisId: this.osnSpisId,
                comment: this.comment.trim() || undefined,
            });
        },
        async post(url: string, body: unknown) {
            const card = this.card!;
            this.errorMessage = '';
            this.okMessage = '';
            this.isSaving = true;
            try {
                const res = await axios.post<{ ok: boolean; message: string }>(url, body);
                this.okMessage = `${card.line.posting}: ${res.data.message}`;
                // Перечитать карточку тем же, что сканировали: штрихкод этикетки есть у каждой записи журнала.
                await Promise.all([this.lookup(card.line.barcode ?? card.line.posting), this.loadList()]);
                this.okMessage = `${card.line.posting}: ${res.data.message}`;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isSaving = false;
            }
        },
    },
});
