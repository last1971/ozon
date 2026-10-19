import { defineStore } from "pinia";
import axios from "../axios.config";
import type { JobState } from "@/contracts/job.state";
import type {
    PromoPriceApplyResult,
    PromoPricePlan,
    PromoPriceState,
    PromoPriceStep,
    PromoStepResult,
    PromoSweepReport,
    PromoTarget,
} from "@/contracts/promo-price.dto";

/** Вид фоновой задачи сверки (src/promos/price-lever/sweep/promo-sweep.context.ts на бэке). */
export const PROMO_SWEEP_JOB = 'ozon-promo-below-min';

/** Запуск сверки «ниже минимума»: apply=false — отчёт, apply=true — применить. Ход — через useJob(PROMO_SWEEP_JOB). */
export const startPromoSweep = async (apply: boolean): Promise<JobState<PromoSweepReport>> =>
    (await axios.post<JobState<PromoSweepReport>>("/api/promos/ozon/below-min-sweep", null, { params: { apply } })).data;

/** Шаг плана человеческими словами — один текст для карточки товара и для сверки. */
export const stepText = (s: PromoPriceStep): string => {
    switch (s.kind) {
        case 'ozon-set':
            return s.from === null ? `Добавить в «${s.title}» по ${s.to} ₽` : `«${s.title}»: цена ${s.from} → ${s.to} ₽`;
        case 'ozon-remove':
            return `Выкинуть из «${s.title}» (${s.reason})`;
        case 'percent':
            return s.from === null ? `Добавить в нашу акцию с ${s.to} %` : `Наша акция: ${s.from} → ${s.to} %`;
    }
};
export const stepIcon = (s: PromoPriceStep) =>
    s.kind === 'ozon-remove' ? 'mdi-close-circle-outline' : s.kind === 'percent' ? 'mdi-percent' : 'mdi-tag-outline';
export const resultColor = (r?: PromoStepResult) =>
    !r ? undefined : r.status === 'ok' ? 'success' : r.status === 'skipped' ? 'warning' : 'error';
export const resultLabel = (r?: PromoStepResult) =>
    !r ? '' : r.status === 'ok' ? 'выполнено' : r.status === 'skipped' ? 'пропущено' : 'отказ';

/** Ошибка API → текст: Nest отдаёт message строкой или массивом (валидация). */
const errorText = (e: any): string => {
    const m = e?.response?.data?.message;
    return Array.isArray(m) ? m.join('; ') : m || e?.message || 'ошибка';
};

/**
 * Акции товара Ozon в карточке цены: состояние, план (dry-run) и применение плана.
 * Применение бэк считает заново из свежего состояния — показанный план может немного отличаться от выполненного.
 * Ключ — offer_id: карточек на экране несколько, каждая грузит своё по кнопке (вызов дорогой, ~45 запросов к Ozon).
 */
export const promoPriceStore = defineStore("promoPriceStore", {
    state: () => ({
        states: {} as Record<string, PromoPriceState>,
        plans: {} as Record<string, PromoPricePlan>,
        applied: {} as Record<string, PromoPriceApplyResult>,
        loading: {} as Record<string, boolean>,
        errors: {} as Record<string, string>,
    }),
    actions: {
        async loadState(offerId: string): Promise<void> {
            this.loading[offerId] = true;
            this.errors[offerId] = '';
            try {
                const res = await axios.post<PromoPriceState[]>("/api/promos/ozon/price-state", { offer_ids: [offerId] });
                const state = res.data[0];
                if (state) this.states[offerId] = state;
                else this.errors[offerId] = 'Ozon не вернул товар';
                delete this.plans[offerId];
                delete this.applied[offerId];
            } catch (e: any) {
                this.errors[offerId] = errorText(e);
            } finally {
                this.loading[offerId] = false;
            }
        },
        async plan(offerId: string, target: PromoTarget, percent?: number): Promise<void> {
            this.loading[offerId] = true;
            this.errors[offerId] = '';
            try {
                const res = await axios.post<PromoPricePlan[]>("/api/promos/ozon/price-plan", {
                    offer_ids: [offerId],
                    target,
                    ...(percent !== undefined ? { percent } : {}),
                });
                const plan = res.data[0];
                if (plan) {
                    this.plans[offerId] = plan;
                    this.states[offerId] = plan.state;
                    delete this.applied[offerId];
                } else this.errors[offerId] = 'Ozon не вернул товар';
            } catch (e: any) {
                this.errors[offerId] = errorText(e);
            } finally {
                this.loading[offerId] = false;
            }
        },
            async apply(offerId: string, target: PromoTarget, percent?: number): Promise<void> {
            this.loading[offerId] = true;
            this.errors[offerId] = '';
            try {
                const res = await axios.post<PromoPriceApplyResult[]>("/api/promos/ozon/price-apply", {
                    offer_ids: [offerId],
                    target,
                    ...(percent !== undefined ? { percent } : {}),
                });
                const result = res.data[0];
                if (result) {
                    this.applied[offerId] = result;
                    this.plans[offerId] = result;
                } else this.errors[offerId] = 'Ozon не вернул товар';
            } catch (e: any) {
                this.errors[offerId] = errorText(e);
            } finally {
                this.loading[offerId] = false;
            }
        },
    },
});
