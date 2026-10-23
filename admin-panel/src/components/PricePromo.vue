<script setup lang="ts">
import { computed, ref } from "vue";
import { promoPriceStore, resultColor, resultLabel, stepIcon, stepText } from "@/stores/promoPrice";
import type { OzonActionSlot, PromoStepResult, PromoTarget } from "@/contracts/promo-price.dto";

/**
 * Акции товара Ozon в карточке цены: где товар участвует, по какой цене, сколько платит покупатель,
 * план (dry-run), как привести цену к цели, и применение плана с итогом по каждому шагу.
 */
const props = defineProps<{ offerId: string }>();
const store = promoPriceStore();

const targetKind = ref<'min' | 'normal' | 'custom'>('min');
const customPrice = ref<string>('');
const percent = ref<string>('');

const state = computed(() => store.states[props.offerId]);
const plan = computed(() => store.plans[props.offerId]);
const applied = computed(() => store.applied[props.offerId]);
const confirmApply = ref(false);
const loading = computed(() => Boolean(store.loading[props.offerId]));
const error = computed(() => store.errors[props.offerId]);

const targetOptions = [
    { title: 'Минимальная', value: 'min' },
    { title: 'Нормальная', value: 'normal' },
    { title: 'Своя цена', value: 'custom' },
];

const target = computed<PromoTarget | null>(() => {
    if (targetKind.value !== 'custom') return targetKind.value;
    const n = Number(customPrice.value);
    return n > 0 ? n : null;
});
const percentValue = computed(() => (percent.value.trim() === '' ? undefined : Number(percent.value)));

/** Акция ещё не началась — на цену покупателю пока не влияет. */
const upcoming = (a: OzonActionSlot) => Boolean(a.startsAt && Date.parse(a.startsAt) > Date.now());
const startText = (a: OzonActionSlot) =>
    new Date(a.startsAt as string).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const belowMin = computed(() => state.value && state.value.buyerPrice < state.value.minPrice);
const formulaMismatch = computed(() => state.value && Math.abs(state.value.buyerPrice - state.value.buyerPriceCalc) > 1);

const runPlan = () => {
    if (target.value !== null) store.plan(props.offerId, target.value, percentValue.value);
};

const runApply = async () => {
    confirmApply.value = false;
    if (target.value !== null) await store.apply(props.offerId, target.value, percentValue.value);
};
/** Итог шага после применения; до применения — undefined. */
const resultOf = (i: number): PromoStepResult | undefined => applied.value?.results[i];
</script>

<template>
    <div class="pa-2">
        <div class="d-flex align-center ga-2 flex-wrap">
            <span class="text-subtitle-1">Акции Ozon</span>
            <v-btn size="small" variant="tonal" prepend-icon="mdi-tag-search-outline" :loading="loading"
                   @click="store.loadState(offerId)">
                {{ state ? 'Обновить' : 'Показать' }}
            </v-btn>
            <template v-if="state">
                <v-chip size="small" :color="belowMin ? 'error' : 'success'" variant="tonal">
                    покупателю {{ state.buyerPrice }} ₽ (мин {{ state.minPrice }}, норм {{ state.price }})
                </v-chip>
                <v-chip v-if="formulaMismatch" size="small" color="warning" variant="tonal">
                    по формуле {{ state.buyerPriceCalc }} ₽ — не сходится с Ozon
                </v-chip>
            </template>
        </div>

        <v-alert v-if="error" type="error" density="compact" class="mt-2">{{ error }}</v-alert>

        <template v-if="state">
            <v-table density="compact" class="mt-2">
                <thead>
                    <tr><th>Акция</th><th>Статус</th><th>Цена в акции</th><th>Лимит</th></tr>
                </thead>
                <tbody>
                    <tr v-if="state.seller">
                        <td>Наша «{{ state.seller.title }}»</td>
                        <td>{{ state.seller.isActive ? 'участвует' : 'кандидат' }}</td>
                        <td>{{ state.seller.isActive ? state.seller.percent + ' %' : '—' }}</td>
                        <td>от {{ state.seller.minPercent }} %</td>
                    </tr>
                    <tr v-else>
                        <td colspan="4" class="text-medium-emphasis">В нашей акции нет и не годится (или акции нет)</td>
                    </tr>
                    <tr v-for="a in state.ozonActions" :key="a.actionId">
                        <td>{{ a.title }}<span v-if="a.isVoucher"> (промокод)</span></td>
                        <td>
                            {{ a.participant ? 'участвует' : 'кандидат' }}
                            <span v-if="upcoming(a)" class="text-medium-emphasis"> · с {{ startText(a) }}</span>
                        </td>
                        <td>{{ a.participant ? a.actionPrice + ' ₽' : '—' }}</td>
                        <td>{{ a.maxActionPrice }} ₽</td>
                    </tr>
                </tbody>
            </v-table>

            <v-row class="mt-2" dense align="center">
                <v-col cols="12" sm="3">
                    <v-select v-model="targetKind" :items="targetOptions" label="Цель" density="compact" hide-details />
                </v-col>
                <v-col v-if="targetKind === 'custom'" cols="6" sm="2">
                    <v-text-field v-model="customPrice" label="Цена" suffix="₽" density="compact" hide-details />
                </v-col>
                <v-col cols="6" sm="2">
                    <v-text-field v-model="percent" label="Наш %" placeholder="авто" density="compact" hide-details />
                </v-col>
                <v-col cols="12" sm="3">
                    <v-btn block prepend-icon="mdi-clipboard-text-search-outline" :loading="loading"
                           :disabled="target === null" @click="runPlan">
                        План (без применения)
                    </v-btn>
                </v-col>
                <v-col cols="12" sm="2">
                    <v-btn block color="primary" prepend-icon="mdi-check-all" :loading="loading"
                           :disabled="!plan || applied !== undefined || !plan.steps.length || target === null"
                           @click="confirmApply = true">
                        Применить
                    </v-btn>
                </v-col>
            </v-row>

            <v-card v-if="plan" variant="outlined" class="mt-2">
                <v-card-text>
                    <div class="mb-1">
                        Цель {{ plan.target }} ₽ · пол для акций Ozon {{ plan.floor }} ₽ ·
                        покупателю <b>{{ plan.buyerBefore }} → {{ plan.buyerAfter }} ₽</b>
                        <v-chip size="x-small" class="ms-1" :color="plan.ok ? 'success' : 'error'" variant="tonal">
                            {{ plan.ok ? 'не ниже минимальной' : 'ниже минимальной' }}
                        </v-chip>
                    </div>
                    <div v-if="!plan.steps.length" class="text-medium-emphasis">Менять нечего</div>
                    <v-alert v-if="applied" density="compact" variant="tonal" class="my-1"
                             :type="applied.applied ? 'success' : 'warning'">
                        {{ applied.applied ? 'Все шаги выполнены' : 'Выполнено не всё — см. шаги' }}.
                        Ozon обновляет цену покупателю не сразу — проверьте кнопкой «Обновить».
                    </v-alert>
                    <v-list density="compact" class="py-0">
                        <v-list-item v-for="(s, i) in (applied ? applied.results.map((r) => r.step) : plan.steps)" :key="i"
                                     :prepend-icon="stepIcon(s)" :title="stepText(s)"
                                     :subtitle="resultOf(i)?.reason">
                            <template v-if="resultOf(i)" v-slot:append>
                                <v-chip size="x-small" variant="tonal" :color="resultColor(resultOf(i))">
                                    {{ resultLabel(resultOf(i)) }}
                                </v-chip>
                            </template>
                        </v-list-item>
                    </v-list>
                    <div v-for="(n, i) in plan.notes" :key="'n' + i" class="text-caption text-medium-emphasis">{{ n }}</div>
                </v-card-text>
            </v-card>
        </template>

        <v-dialog v-model="confirmApply" max-width="520">
            <v-card v-if="plan">
                <v-card-title class="text-subtitle-1">Применить план для {{ offerId }}?</v-card-title>
                <v-card-text>
                    <div v-for="(s, i) in plan.steps" :key="i">• {{ stepText(s) }}</div>
                    <div class="mt-2">Покупателю {{ plan.buyerBefore }} → {{ plan.buyerAfter }} ₽.</div>
                    <div class="text-caption text-medium-emphasis mt-1">
                        Бэк перечитает состояние и пересчитает план перед выполнением — если на Ozon что-то
                        поменялось, шаги могут отличаться. Выйти из нашей акции, пока товар в Ozon-акции, нельзя.
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="confirmApply = false">Отмена</v-btn>
                    <v-btn color="primary" variant="flat" @click="runApply">Применить</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>
