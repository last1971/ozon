import { defineStore } from "pinia";
import { watch } from "vue";
import axios from "../axios.config";

const STORAGE_KEY = 'wb-copy-product-form';

function defaultForm() {
    return {
        offerId: '',
        categoryMode: 'byOzonType' as 'manual' | 'byOzonType' | 'byName',
        subjectId: null as number | null,
        webSearch: false,
        nmId: null as number | null,
    };
}

type FormState = ReturnType<typeof defaultForm>;

function loadForm(): FormState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw) as FormState;
    } catch {}
    return null;
}

export const wbCopyProductStore = defineStore("wbCopyProductStore", {
    state: () => ({
        form: loadForm() || defaultForm(),
        isCreating: false,
        isUploading: false,
        createResult: null as any,
        uploadResult: null as any,
        errorMessage: '',
        _watcherInit: false,
    }),
    actions: {
        initWatcher() {
            if (this._watcherInit) return;
            this._watcherInit = true;
            watch(() => this.form, (val) => {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
            }, { deep: true });
        },
        async createCard() {
            this.errorMessage = '';
            if (!this.form.offerId.trim()) {
                this.errorMessage = 'Заполните артикул';
                return;
            }
            this.isCreating = true;
            this.createResult = null;
            try {
                const body: any = {
                    offerId: this.form.offerId.trim(),
                    categoryMode: this.form.categoryMode,
                    submit: true,
                };
                if (this.form.categoryMode === 'manual' && this.form.subjectId) {
                    body.subjectId = this.form.subjectId;
                }
                if (this.form.webSearch) body.webSearch = true;
                const res = await axios.post("/api/wb-card/create", body);
                this.createResult = res.data;
                if (res.data.error) {
                    this.errorMessage = res.data.error_message || 'Ошибка создания';
                }
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isCreating = false;
            }
        },
        async uploadMedia() {
            this.errorMessage = '';
            if (!this.form.offerId.trim()) {
                this.errorMessage = 'Заполните артикул';
                return;
            }
            if (!this.form.nmId) {
                this.errorMessage = 'Заполните nmId';
                return;
            }
            this.isUploading = true;
            this.uploadResult = null;
            try {
                const res = await axios.post("/api/wb-card/upload-media", {
                    offerId: this.form.offerId.trim(),
                    nmId: this.form.nmId,
                });
                this.uploadResult = res.data;
                if (res.data.error) {
                    this.errorMessage = res.data.error_message || 'Ошибка загрузки';
                }
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isUploading = false;
            }
        },
        clearAll() {
            this.form = defaultForm();
            this.createResult = null;
            this.uploadResult = null;
            this.errorMessage = '';
        },
    },
});
