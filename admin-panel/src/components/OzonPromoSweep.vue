<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useJob } from "@/composable/useJob";
import { clientId } from "@/axios.config";
import { PROMO_SWEEP_JOB, resultColor, resultLabel, startPromoSweep, stepIcon, stepText } from "@/stores/promoPrice";
import { SWEEP_GOALS, type PromoSweepItem, type PromoSweepReport, type SweepGoalKind } from "@/contracts/promo-price.dto";

/**
 * Сверка акций Ozon по цели: все товары в акциях, которые цель отбирает, и план по каждому.
 * Что отбирать и к чему вести — решает бэк по цели; экран только выбирает её.
 * «Проверить» — только отчёт, «Применить всё» — выполнить. Фоновая задача, подхватывается после F5.
 */
const sweep = useJob<PromoSweepReport>(PROMO_SWEEP_JOB);
const confirmApply = ref(false);
const goal = ref<SweepGoalKind>('below-min');
const goalInfo = computed(() => SWEEP_GOALS.find((g) => g.value === goal.value)!);
/** Цель, по которой посчитан показанный отчёт. */
const reportGoal = computed(() => SWEEP_GOALS.find((g) => g.value === report.value?.goal));
const me = clientId();

onMounted(() => sweep.attach());
// Подхваченная после F5 задача — выбор цели встаёт по ней, иначе «Применить всё» закрыто.
watch(
    () => sweep.box.job?.params?.goal as SweepGoalKind | undefined,
    (g) => {
        if (g) goal.value = g;
    },
    { immediate: true },
);

const job = computed(() => sweep.box.job);
const running = computed(() => job.value?.status === 'running');
const report = computed(() => (job.value?.status === 'done' ? job.value.result ?? null : null));
/** Применять можно только после проверки по выбранной цели, и только если есть что. */
const canApply = computed(
    () =>
        !!report.value &&
        !report.value.apply &&
        report.value.goal === goal.value &&
        report.value.items.some((i) => i.steps.length),
);

const progressText = computed(() => {
    const p = job.value?.progress;
    if (!p) return '';
    const phase = p.phase ?? '…';
    return p.total ? `${phase}: ${p.done} из ${p.total}` : phase;
});
const progressPercent = computed(() => {
    const p = job.value?.progress;
    return p?.total ? Math.round((p.done / p.total) * 100) : undefined;
});
const whose = (j: { clientId?: string }) => (j.clientId && j.clientId === me ? 'моя' : 'с другого компьютера');

const headers = [
    { title: 'Артикул', key: 'offerId' },
    { title: 'Покупателю', key: 'buyerBefore' },
    { title: 'Станет', key: 'buyerAfter' },
    { title: 'Цель', key: 'target' },
    { title: 'Мин', key: 'minPrice' },
    { title: 'Норм', key: 'price' },
    { title: 'Шаги', key: 'steps', sortable: false },
];
/** Насколько цена покупателю от цели: «+12 %» дороже, «−5 %» дешевле. */
const offTarget = (i: PromoSweepItem) => {
    const d = Math.round((i.buyerBefore / i.target - 1) * 100);
    return d > 0 ? `+${d} %` : `−${-d} %`;
};

async function check() {
    await sweep.start(() => startPromoSweep(false, goal.value));
}
async function applyAll() {
    confirmApply.value = false;
    await sweep.start(() => startPromoSweep(true, goal.value));
}
</script>

<template>
    <v-container fluid class="pa-0">
        <div class="text-body-2 text-medium-emphasis mb-2">
            {{ goalInfo.hint }} Дальше цену по товару подгоняют в карточке цены, блок «Акции Ozon».
        </div>
        <v-alert v-if="sweep.box.error" type="error" density="compact" class="mb-2" closable
                 @click:close="sweep.box.error = ''">{{ sweep.box.error }}</v-alert>

        <div class="d-flex ga-2 align-center">
            <v-select v-model="goal" :items="SWEEP_GOALS" item-title="title" item-value="value" label="Цель"
                      density="compact" hide-details style="max-width: 280px" :disabled="running" />
            <v-btn prepend-icon="mdi-magnify" :loading="running" @click="check">Проверить</v-btn>
            <v-btn color="primary" prepend-icon="mdi-check-all" :disabled="!canApply || running"
                   @click="confirmApply = true">Применить всё</v-btn>
        </div>

        <v-card v-if="job" class="mt-4" variant="tonal" :color="job.status === 'failed' ? 'error' : running ? 'primary' : 'success'">
            <v-card-text>
                <div class="d-flex align-center mb-2">
                    <v-icon :icon="running ? 'mdi-progress-clock' : job.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check-circle'" class="me-2" />
                    <span class="font-weight-medium">
                        {{ job.params.apply ? 'применение' : 'проверка' }}
                        <template v-if="reportGoal"> «{{ reportGoal.title }}»</template> · {{ whose(job) }}
                        · {{ running ? progressText : job.status === 'failed' ? `ошибка: ${job.error}` : 'готово' }}
                    </span>
                </div>
                <v-progress-linear v-if="running" :model-value="progressPercent"
                                   :indeterminate="progressPercent === undefined" height="8" rounded />
                <div v-if="report" class="mt-2 text-body-2">
                    <span class="me-4">в акциях: {{ report.checked }}</span>
                    <span class="me-4"><b>отобрано: {{ report.selected }}</b></span>
                    <span class="me-4">остаются в акциях Ozon: {{ report.keptInOzon }}</span>
                    <span class="me-4">выкинуть из акций Ozon: {{ report.removedFromOzon }}</span>
                    <span class="me-4">меняется наш процент: {{ report.percentChanged }}</span>
                    <span v-if="report.unfixable" class="me-4 text-error">не вытянуть: {{ report.unfixable }}</span>
                    <span v-if="report.closest" class="me-4 text-medium-emphasis">ближе нельзя: {{ report.closest }}</span>
                    <span v-if="report.nothingToDo" class="me-4 text-warning">смотреть руками: {{ report.nothingToDo }}</span>
                    <span v-if="report.apply" class="me-4" :class="report.failed ? 'text-error' : ''">не всё прошло: {{ report.failed }}</span>
                </div>
            </v-card-text>
        </v-card>

        <v-data-table v-if="report" :headers="headers" :items="report.items" item-value="productId" density="compact"
                      class="mt-2" :items-per-page="50">
            <template v-slot:item.buyerBefore="{ item }">
                <span :class="item.buyerBefore < item.minPrice ? 'text-error' : ''">{{ item.buyerBefore }} ₽</span>
                <span class="text-caption text-medium-emphasis"> {{ offTarget(item) }}</span>
            </template>
            <template v-slot:item.target="{ item }">{{ item.target }} ₽</template>
            <template v-slot:item.buyerAfter="{ item }">
                <span :class="item.ok ? 'text-success' : 'text-error'">{{ item.buyerAfter }} ₽</span>
            </template>
            <template v-slot:item.minPrice="{ item }">{{ item.minPrice }} ₽</template>
            <template v-slot:item.price="{ item }">{{ item.price }} ₽</template>
            <template v-slot:item.steps="{ item }">
                <div v-for="(s, i) in item.steps" :key="i" class="text-body-2 d-flex align-center ga-1">
                    <v-icon :icon="stepIcon(s)" size="small" />
                    <span>{{ stepText(s) }}</span>
                    <v-chip v-if="item.results?.[i]" size="x-small" variant="tonal" :color="resultColor(item.results[i])">
                        {{ resultLabel(item.results[i]) }}<template v-if="item.results[i].reason">: {{ item.results[i].reason }}</template>
                    </v-chip>
                </div>
                <div v-if="item.closest" class="text-medium-emphasis text-body-2">ближе нельзя — следующий шаг уводит ниже цели</div>
                <div v-else-if="!item.steps.length" class="text-warning text-body-2">шагов нет — смотреть в карточке цены</div>
            </template>
        </v-data-table>

        <v-dialog v-model="confirmApply" max-width="520">
            <v-card v-if="report">
                <v-card-title class="text-subtitle-1">
                    «{{ reportGoal?.title }}»: применить план по {{ report.selected }} товарам?
                </v-card-title>
                <v-card-text>
                    Остаются в акциях Ozon с ценой не ниже минимальной: {{ report.keptInOzon }}.
                    Выкидываются из акций Ozon: {{ report.removedFromOzon }}. Меняется наш процент: {{ report.percentChanged }}.
                    <div class="text-caption text-medium-emphasis mt-2">
                        Сервер заново прочитает акции и пересчитает план, если на Ozon что-то поменялось.
                        Идёт фоном, займёт несколько минут; итог по каждому товару будет в таблице.
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="confirmApply = false">Отмена</v-btn>
                    <v-btn color="primary" variant="flat" @click="applyAll">Применить</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-container>
</template>
