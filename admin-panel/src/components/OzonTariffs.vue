<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
import type { JobState } from '@/contracts/job.state';
import JobProgress from '@/components/JobProgress.vue';

type Kind = 'commissions' | 'logistics';
type Source = {
    kind: Kind;
    filename: string | null;
    fileDate: string | null;
    uploadedAt: string | null;
    rows: number;
    matchedCount: number | null;
    retiredCount: number | null;
    stale: boolean;
};
type ImportResult = {
    updated?: number;
    rows: number;
    routeRates?: number;
    defaultRates?: number;
    missingTypes?: { id: number; name: string }[];
    retiredTypes?: { id: number; name: string }[];
};
const cards: { kind: Kind; title: string; endpoint: string }[] = [
    { kind: 'commissions', title: 'Комиссии FBO / FBS', endpoint: 'import-commissions' },
    { kind: 'logistics', title: 'Доставка FBO / FBS', endpoint: 'import-logistics' },
];
const jobs = {
    commissions: useJob<ImportResult>('ozon-tariffs-commissions'),
    logistics: useJob<ImportResult>('ozon-tariffs-logistics'),
};
const sources = ref<Source[]>([]);
const files = ref<Record<Kind, File | File[] | null>>({ commissions: null, logistics: null });
const uploading = ref(false);
const readError = ref('');
const busy = computed(() => uploading.value || Object.values(jobs).some((job) => job.box.job?.status === 'running'));
const error = computed(
    () =>
        readError.value ||
        Object.values(jobs)
            .map((job) => job.box.error || (job.box.job?.status === 'failed' ? job.box.job.error : ''))
            .find(Boolean),
);
const completed = computed(
    () =>
        Object.values(jobs)
            .map((job) => job.box.job)
            .filter((job): job is JobState<ImportResult> => job?.status === 'done')
            .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0],
);
const result = computed(() => {
    const job = completed.value;
    if (!job?.result) return '';
    return job.kind === 'ozon-tariffs-commissions'
        ? `Комиссии сохранены: ${job.result.updated} типов товаров из ${job.result.rows} строк файла.`
        : `Доставка сохранена: ${job.result.routeRates} ставок по маршрутам, ${job.result.defaultRates} ставок по умолчанию.`;
});
const missing = computed(() => completed.value?.result?.missingTypes ?? []);
const retired = computed(() => completed.value?.result?.retiredTypes ?? []);
const source = (kind: Kind) => sources.value.find((s) => s.kind === kind);
const when = (value?: string | null) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
async function refresh() {
    try {
        sources.value = (await axios.get<Source[]>('/api/ozon-category/tariffs')).data;
        readError.value = '';
    } catch {
        readError.value = 'Не удалось обновить сведения о тарифах.';
    }
}
async function upload(card: (typeof cards)[number]) {
    const selected = files.value[card.kind];
    const file = Array.isArray(selected) ? selected[0] : selected;
    if (!file) return;
    uploading.value = true;
    readError.value = '';
    try {
        const form = new FormData();
        form.append('file', file);
        await jobs[card.kind].start(
            async () => (await axios.post<JobState<ImportResult>>(`/api/ozon-category/${card.endpoint}`, form)).data,
        );
        if (!jobs[card.kind].box.error) files.value[card.kind] = null;
    } finally {
        uploading.value = false;
    }
}
watch(
    () => Object.values(jobs).map((job) => `${job.box.job?.id}:${job.box.job?.status}`),
    (states, before) => {
        if (states.some((state, i) => state.endsWith(':done') && state !== before?.[i])) void refresh();
    },
);
onMounted(() => Promise.all([refresh(), jobs.commissions.attach(), jobs.logistics.attach()]));
</script>

<template>
    <div>
        <h2 class="mb-4">Тарифы Ozon</h2>
        <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
        <v-alert v-if="result" type="success" class="mb-4">{{ result }}</v-alert>
        <v-alert v-if="missing.length" type="warning" class="mb-4">
            Для {{ missing.length }} типов не определена комиссия. Таких товаров в вашем кабинете нет. Файл загружен.
            <details>
                <summary>Показать типы товаров</summary>
                <div v-for="item in missing" :key="item.id">{{ item.id }} — {{ item.name }}</div>
            </details>
        </v-alert>
        <v-alert v-if="retired.length" type="warning" class="mb-4">
            Исключено {{ retired.length }} типов: отключены в справочнике или отсутствуют в актуальном дереве Ozon.
            <details>
                <summary>Показать типы товаров</summary>
                <div v-for="item in retired" :key="item.id">{{ item.id }} — {{ item.name }}</div>
            </details>
        </v-alert>
        <v-row>
            <v-col v-for="card in cards" :key="card.kind" cols="12" md="6">
                <v-card variant="outlined" class="pa-4">
                    <h3 class="mb-3">{{ card.title }}</h3>
                    <JobProgress v-if="jobs[card.kind].box.job" :job="jobs[card.kind].box.job!" />
                    <p>Файл: {{ source(card.kind)?.filename || 'не загружен' }}</p>
                    <p>Дата файла: {{ source(card.kind)?.fileDate || '—' }}</p>
                    <p>Загружен: {{ when(source(card.kind)?.uploadedAt) }}</p>
                    <p>Сохранено строк: {{ source(card.kind)?.rows ?? 0 }}</p>
                    <p v-if="card.kind === 'commissions'">
                        Типов с комиссией: {{ source(card.kind)?.matchedCount ?? '—' }}; исключено устаревших:
                        {{ source(card.kind)?.retiredCount ?? '—' }}
                    </p>
                    <v-alert v-if="source(card.kind)?.stale" type="warning" density="compact" class="my-3">
                        {{
                            source(card.kind)?.filename
                                ? 'Файл старше семи дней. Загрузите свежий.'
                                : 'Загрузите файл тарифов.'
                        }}
                    </v-alert>
                    <v-file-input
                        v-model="files[card.kind]"
                        accept=".xlsx"
                        label="Выберите XLSX Ozon"
                        :disabled="busy"
                        class="mt-4"
                        hide-details="auto"
                    />
                    <v-btn
                        color="primary"
                        class="mt-3"
                        :disabled="
                            busy ||
                            !files[card.kind] ||
                            (Array.isArray(files[card.kind]) && !(files[card.kind] as File[]).length)
                        "
                        :loading="busy"
                        @click="upload(card)"
                        >Загрузить тарифы</v-btn
                    >
                </v-card>
            </v-col>
        </v-row>
        <p class="mt-4">
            Новый файл полностью заменит прежние тарифы своего вида. Если нет комиссии для вашего товара, загрузка
            остановится и прежние тарифы сохранятся. Для остальных типов без комиссии появится предупреждение.
        </p>
        <p>В этом разделе загружаются тарифы. Пересчёт и отправка цен отсюда не запускаются.</p>
    </div>
</template>
