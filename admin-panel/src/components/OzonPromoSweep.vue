<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useJob } from "@/composable/useJob";
import { clientId } from "@/axios.config";
import { PROMO_SWEEP_JOB, resultColor, resultLabel, startPromoSweep, stepIcon, stepText } from "@/stores/promoPrice";
import type { PromoSweepItem, PromoSweepReport } from "@/contracts/promo-price.dto";

/**
 * Сверка акций Ozon «ниже минимума»: все товары в акциях, у которых цена покупателю ниже min_price,
 * и план по каждому (процент нашей акции — её минимум, Ozon-акции держат пол или выкидываются).
 * «Проверить» — только отчёт, «Применить всё» — выполнить. Фоновая задача, подхватывается после F5.
 */
const sweep = useJob<PromoSweepReport>(PROMO_SWEEP_JOB);
const confirmApply = ref(false);
const me = clientId();

onMounted(() => sweep.attach());

const job = computed(() => sweep.box.job);
const running = computed(() => job.value?.status === 'running');
const report = computed(() => (job.value?.status === 'done' ? job.value.result ?? null : null));
/** Применять можно только после проверки, и только если есть что. */
const canApply = computed(() => !!report.value && !report.value.apply && report.value.items.some((i) => i.steps.length));

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
    { title: 'Мин', key: 'minPrice' },
    { title: 'Норм', key: 'price' },
    { title: 'Шаги', key: 'steps', sortable: false },
];
const lossPercent = (i: PromoSweepItem) => Math.round((1 - i.buyerBefore / i.minPrice) * 100);

async function check() {
    await sweep.start(() => startPromoSweep(false));
}
async function applyAll() {
    confirmApply.value = false;
    await sweep.start(() => startPromoSweep(true));
}
</script>

<template>
    <v-container fluid class="pa-0">
        <div class="text-body-2 text-medium-emphasis mb-2">
            Товары в акциях, у которых цена покупателю ниже минимальной. План: наш процент — минимум акции,
            акции Ozon остаются, если их лимит держит минимальную, иначе товар из них выкидывается.
            Дальше цену по товару подгоняют в карточке цены, блок «Акции Ozon».
        </div>
        <v-alert v-if="sweep.box.error" type="error" density="compact" class="mb-2" closable
                 @click:close="sweep.box.error = ''">{{ sweep.box.error }}</v-alert>

        <div class="d-flex ga-2">
            <v-btn prepend-icon="mdi-magnify" :loading="running" @click="check">Проверить</v-btn>
            <v-btn color="primary" prepend-icon="mdi-check-all" :disabled="!canApply || running"
                   @click="confirmApply = true">Применить всё</v-btn>
        </div>

        <v-card v-if="job" class="mt-4" variant="tonal" :color="job.status === 'failed' ? 'error' : running ? 'primary' : 'success'">
            <v-card-text>
                <div class="d-flex align-center mb-2">
                    <v-icon :icon="running ? 'mdi-progress-clock' : job.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check-circle'" class="me-2" />
                    <span class="font-weight-medium">
                        {{ job.params.apply ? 'применение' : 'проверка' }} · {{ whose(job) }}
                        · {{ running ? progressText : job.status === 'failed' ? `ошибка: ${job.error}` : 'готово' }}
                    </span>
                </div>
                <v-progress-linear v-if="running" :model-value="progressPercent"
                                   :indeterminate="progressPercent === undefined" height="8" rounded />
                <div v-if="report" class="mt-2 text-body-2">
                    <span class="me-4">в акциях: {{ report.checked }}</span>
                    <span class="me-4"><b>ниже минимума: {{ report.belowMin }}</b></span>
                    <span class="me-4">остаются в акциях Ozon: {{ report.keptInOzon }}</span>
                    <span class="me-4">выкинуть из акций Ozon: {{ report.removedFromOzon }}</span>
                    <span class="me-4">меняется наш процент: {{ report.percentChanged }}</span>
                    <span v-if="report.unfixable" class="me-4 text-error">не вытянуть: {{ report.unfixable }}</span>
                    <span v-if="report.nothingToDo" class="me-4 text-warning">смотреть руками: {{ report.nothingToDo }}</span>
                    <span v-if="report.apply" class="me-4" :class="report.failed ? 'text-error' : ''">не всё прошло: {{ report.failed }}</span>
                </div>
            </v-card-text>
        </v-card>

        <v-data-table v-if="report" :headers="headers" :items="report.items" item-value="productId" density="compact"
                      class="mt-2" :items-per-page="50">
            <template v-slot:item.buyerBefore="{ item }">
                <span class="text-error">{{ item.buyerBefore }} ₽</span>
                <span class="text-caption text-medium-emphasis"> −{{ lossPercent(item) }} %</span>
            </template>
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
                <div v-if="!item.steps.length" class="text-warning text-body-2">шагов нет — смотреть в карточке цены</div>
            </template>
        </v-data-table>

        <v-dialog v-model="confirmApply" max-width="520">
            <v-card v-if="report">
                <v-card-title class="text-subtitle-1">Применить план по {{ report.belowMin }} товарам?</v-card-title>
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
