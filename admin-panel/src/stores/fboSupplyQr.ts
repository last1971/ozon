import { defineStore } from "pinia";
import axios from "../axios.config";
import { readUser } from "./username";

/** Зеркало src/fbo-supply-qr/dto/supply-qr.dto.ts на бэке. */
export interface SupplyLine {
    offerId: string;
    ozonBarcode: string;
    goodscode: number | null;
    pieces: number;
    name: string | null;
    need: number;
}

export interface SupplyBox {
    cargoId: string;
    cargoType: string;
    lines: SupplyLine[];
}

export interface SupplyBound {
    qr: string;
    cargoId: string;
    offerId: string;
    goodscode: number;
    ki: string | null;
    username: string | null;
    createdAt: string;
}

export interface ResolvedProduct {
    goodscode: number;
    name: string | null;
    offerIds: string[];
    ki: string | null;
}

/** Половина пары «этикетка + товар»: что уже отсканировано и ждёт вторую половину. */
interface Pending {
    qr: string | null;
    product: { scan: string; resolved: ResolvedProduct; offerId: string | null } | null;
}

const QR_RE = /^ii\d{6,}$/i;
const CARGO_RE = /^\d{16}$/;

const errorText = (e: any): string => e.response?.data?.message || e.message;

/** Короткий сигнал сканеру: высокий — записали, низкий — отказ. Без сети и файлов. */
function beep(ok: boolean) {
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.frequency.value = ok ? 880 : 220;
        osc.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
        osc.onended = () => ctx.close();
    } catch {
        // звук недоступен — экран всё равно покажет результат
    }
}

export const fboSupplyQrStore = defineStore("fboSupplyQr", {
    state: () => ({
        file: null as File | null,
        boxes: [] as SupplyBox[],
        bound: [] as SupplyBound[],
        cargoId: '' as string,
        pending: { qr: null, product: null } as Pending,
        username: readUser(),
        info: '',
        errorMessage: '',
        isLoading: false,
    }),
    getters: {
        box: (state): SupplyBox | null => state.boxes.find((b) => b.cargoId === state.cargoId) ?? null,
        doneOf: (state) => (cargoId: string, offerId: string) =>
            state.bound.filter((b) => b.cargoId === cargoId && b.offerId === offerId).length,
        boxDone(): (box: SupplyBox) => boolean {
            return (box) => box.lines.every((l) => this.doneOf(box.cargoId, l.offerId) >= l.need);
        },
        totals(state): { need: number; done: number } {
            const need = state.boxes.reduce((s, b) => s + b.lines.reduce((x, l) => x + l.need, 0), 0);
            return { need, done: state.bound.length };
        },
        /** Подсказка, что сканировать дальше. */
        hint(): string {
            if (!this.boxes.length) return 'Загрузите файл Озона «Состав грузомест»';
            if (!this.box) return 'Отсканируйте этикетку коробки';
            const p = this.pending;
            if (p.product && !p.product.offerId && p.product.resolved.offerIds.length > 1) return 'Выберите артикул';
            if (p.product) return `Наклейте этикетку Озона и отсканируйте её QR — для ${p.product.offerId ?? p.product.resolved.offerIds[0]} ${p.product.resolved.name ?? ''}`;
            if (p.qr) return `Этикетка ${p.qr}: отсканируйте товар (штрихкод или код ЧЗ)`;
            return 'Отсканируйте товар или этикетку Озона';
        },
    },
    actions: {
        async load(file: File) {
            this.errorMessage = '';
            this.info = '';
            this.isLoading = true;
            try {
                const form = new FormData();
                form.append('file', file);
                const { data } = await axios.post('/api/fbo-supply-qr/template', form);
                this.file = file;
                this.boxes = data.boxes;
                this.bound = data.bound;
                this.cargoId = '';
                this.pending = { qr: null, product: null };
            } catch (e: any) {
                this.errorMessage = errorText(e);
            } finally {
                this.isLoading = false;
            }
        },

        async scan(raw: string) {
            const s = raw.trim();
            if (!s) return;
            this.errorMessage = '';
            this.info = '';
            if (!this.boxes.length) return this.fail('Сначала загрузите файл Озона');
            if (CARGO_RE.test(s)) return this.pickBox(s);
            if (!this.box) return this.fail('Сначала отсканируйте этикетку коробки');
            this.isLoading = true;
            try {
                if (QR_RE.test(s)) await this.takeQr(s.toLowerCase());
                else await this.takeProduct(s);
            } catch (e: any) {
                this.fail(errorText(e));
            } finally {
                this.isLoading = false;
            }
        },

        pickBox(cargoId: string) {
            const box = this.boxes.find((b) => b.cargoId === cargoId);
            if (!box) return this.fail(`Коробки ${cargoId} нет в загруженном файле`);
            this.cargoId = cargoId;
            this.pending = { qr: null, product: null };
            this.info = this.boxDone(box) ? `Коробка ${cargoId} уже собрана` : `Коробка ${cargoId}`;
            beep(true);
        },

        async takeQr(qr: string) {
            const { data } = await axios.get(`/api/fbo-supply-qr/qr/${encodeURIComponent(qr)}`);
            if (data) return this.fail(`Этикетка ${qr} уже наклеена: коробка ${data.cargoId}, артикул ${data.offerId}`);
            if (this.pending.qr && this.pending.qr !== qr) this.info = `Этикетка ${this.pending.qr} заменена на ${qr}`;
            this.pending.qr = qr;
            if (this.pending.product) await this.bind();
        },

        async takeProduct(scan: string) {
            const other = this.boxes.find((b) => b.cargoId !== this.cargoId && b.lines.some((l) => l.ozonBarcode === scan));
            if (other && !this.box?.lines.some((l) => l.ozonBarcode === scan)) return this.fail(`Этот товар из коробки ${other.cargoId}`);
            const { data } = await axios.post('/api/fbo-supply-qr/resolve', { cargoId: this.cargoId, lines: this.boxLines(), scan });
            const resolved = data as ResolvedProduct;
            const open = resolved.offerIds.filter((o) => this.doneOf(this.cargoId, o) < this.needOf(o));
            if (!open.length) return this.fail(`По ${resolved.offerIds.join(', ')} в этой коробке уже всё набрано`);
            if (this.pending.product) this.info = 'Предыдущий товар без этикетки сброшен';
            this.pending.product = { scan, resolved: { ...resolved, offerIds: open }, offerId: open.length === 1 ? open[0] : null };
            if (this.pending.product.offerId) beep(true);
            if (this.pending.qr && this.pending.product.offerId) await this.bind();
        },

        async chooseOffer(offerId: string) {
            if (!this.pending.product) return;
            this.pending.product.offerId = offerId;
            if (this.pending.qr) {
                this.isLoading = true;
                try {
                    await this.bind();
                } catch (e: any) {
                    this.fail(errorText(e));
                } finally {
                    this.isLoading = false;
                }
            }
        },

        async bind() {
            const p = this.pending;
            if (!p.qr || !p.product?.offerId) return;
            if (!this.username.trim()) throw new Error('Укажите, кто собирает — поле вверху экрана');
            const { data } = await axios.post('/api/fbo-supply-qr/bind', {
                cargoId: this.cargoId,
                lines: this.boxLines(),
                scan: p.product.scan,
                qr: p.qr,
                offerId: p.product.offerId,
                username: this.username.trim(),
            });
            this.bound.push(data);
            this.pending = { qr: null, product: null };
            beep(true);
            const box = this.box;
            this.info = box && this.boxDone(box) ? `Коробка ${box.cargoId} готова — сканируйте следующую` : `Записано: ${data.qr} → ${data.offerId}`;
        },

        async unbind(qr: string) {
            this.errorMessage = '';
            try {
                await axios.delete(`/api/fbo-supply-qr/qr/${encodeURIComponent(qr)}`);
                this.bound = this.bound.filter((b) => b.qr !== qr);
                this.info = `Этикетка ${qr} отвязана`;
            } catch (e: any) {
                this.fail(errorText(e));
            }
        },

        /** Последняя привязка в текущей коробке — её же можно отвязать кнопкой «Отменить последнюю». */
        lastInBox(): SupplyBound | null {
            const mine = this.bound.filter((b) => b.cargoId === this.cargoId);
            return mine[mine.length - 1] ?? null;
        },

        resetPending() {
            this.pending = { qr: null, product: null };
        },

        async download() {
            if (!this.file) return;
            this.errorMessage = '';
            this.isLoading = true;
            try {
                const form = new FormData();
                form.append('file', this.file);
                const res = await axios.post('/api/fbo-supply-qr/export', form, { responseType: 'blob' });
                const empty = Number(res.headers['x-empty-rows'] ?? 0);
                const url = URL.createObjectURL(res.data);
                const a = document.createElement('a');
                a.href = url;
                a.download = this.file.name;
                a.click();
                URL.revokeObjectURL(url);
                if (empty) this.info = `Файл скачан, но ${empty} строк без QR — Озон такой не примет`;
            } catch (e: any) {
                this.errorMessage = errorText(e);
            } finally {
                this.isLoading = false;
            }
        },

        boxLines() {
            return (this.box?.lines ?? []).map((l) => ({ offerId: l.offerId, ozonBarcode: l.ozonBarcode, need: l.need }));
        },

        needOf(offerId: string): number {
            return this.box?.lines.find((l) => l.offerId === offerId)?.need ?? 0;
        },

        fail(message: string) {
            this.errorMessage = message;
            beep(false);
        },
    },
});
