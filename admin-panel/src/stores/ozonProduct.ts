import { defineStore } from "pinia";
import { watch } from "vue";
import axios from "../axios.config";

const STORAGE_KEY = 'ozon-product-form';

function loadForm() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return null;
}

function defaultForm() {
    return {
        text: '',
        offer_id: '',
        package_depth: null as number | null,
        package_width: null as number | null,
        package_height: null as number | null,
        weight_with_packaging: null as number | null,
        weight_without_packaging: null as number | null,
        images: [''] as string[],
        pdf_list: [] as { index: number; name: string; src_url: string }[],
        quantities: [] as (number | null)[],
        packages: [] as (number | null | string)[],
        category_path: '',
        all_attributes: false,
        provider: '',
        model: '',
    };
}

export const ozonProductStore = defineStore("ozonProductStore", {
    state: () => ({
        form: loadForm() || defaultForm(),
        isCreating: false,
        isChecking: false,
        createResult: null as any,
        importInfo: null as any,
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
        async createProduct() {
            this.errorMessage = '';
            if (!this.form.text.trim()) { this.errorMessage = 'Заполните текст товара'; return; }
            if (!this.form.offer_id.trim()) { this.errorMessage = 'Заполните артикул'; return; }
            if (!this.form.images.some(img => img.trim())) { this.errorMessage = 'Добавьте хотя бы одну картинку'; return; }
            this.isCreating = true;
            this.createResult = null;
            try {
                const body: any = {
                    text: this.form.text,
                    offer_id: this.form.offer_id,
                    images: this.form.images.filter(img => img.trim()),
                };
                if (this.form.package_depth) body.package_depth = this.form.package_depth;
                if (this.form.package_width) body.package_width = this.form.package_width;
                if (this.form.package_height) body.package_height = this.form.package_height;
                if (this.form.weight_with_packaging) body.weight_with_packaging = this.form.weight_with_packaging;
                if (this.form.weight_without_packaging) body.weight_without_packaging = this.form.weight_without_packaging;
                // Опциональные поля — передаём только если заполнены
                const pdfs = this.form.pdf_list.filter(p => p.name && p.src_url);
                if (pdfs.length) body.pdf_list = pdfs;

                const qtys = this.form.quantities.filter(q => q !== null && q !== undefined) as number[];
                if (qtys.length) body.quantities = qtys;

                const pkgs = this.form.packages
                    .map(p => {
                        if (p === null || p === undefined || p === '') return null;
                        if (typeof p === 'string' && p.includes(',')) {
                            const parts = p.split(',').map(s => Number(s.trim()));
                            if (parts.length === 3 && parts.every(n => !isNaN(n))) return parts;
                            return null;
                        }
                        const n = Number(p);
                        return isNaN(n) ? null : n;
                    })
                    .filter(p => p !== null);
                if (pkgs.length) body.packages = pkgs;

                if (this.form.category_path.trim()) body.category_path = this.form.category_path.trim();
                if (this.form.all_attributes) body.all_attributes = 1;
                if (this.form.provider) body.provider = this.form.provider;
                if (this.form.model) body.model = this.form.model;

                const res = await axios.post("/api/ozon-category/create-product", body);
                this.createResult = res.data;
                if (res.data.error) {
                    this.errorMessage = res.data.error_message || 'Неизвестная ошибка';
                }
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isCreating = false;
            }
        },
        async checkImport() {
            if (!this.createResult?.task_id) return;
            this.isChecking = true;
            try {
                const res = await axios.get("/api/ozon-category/import-info", {
                    params: { task_id: this.createResult.task_id },
                });
                this.importInfo = res.data;
            } catch (e: any) {
                this.errorMessage = e.response?.data?.message || e.message;
            } finally {
                this.isChecking = false;
            }
        },
        clearAll() {
            this.form = defaultForm();
            this.createResult = null;
            this.importInfo = null;
            this.errorMessage = '';
            localStorage.removeItem(STORAGE_KEY);
        },
    },
});
