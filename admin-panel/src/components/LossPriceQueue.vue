<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
import type { JobState } from '@/contracts/job.state';
import JobProgress from './JobProgress.vue';
const props = defineProps<{ service: string; revision?: string }>();
type QueueResult = {
    processed: number;
    completed: number;
    sent: number;
    waitingStock?: number;
    pending: { offerId: string; error: string }[];
};
const jobs = Object.fromEntries(
    ['OZON', 'WB'].map((s) => [s, useJob<QueueResult>(`loss-price-update:${s.toLowerCase()}`, { followLatest: true })]),
);
const selected = computed(() => jobs[props.service]);
const job = computed(() => selected.value?.box.job);
const pending = ref<
    {
        extId: string;
        payload?: { offerId?: string; attempts?: number; lastError?: string; waitingForStock?: boolean };
    }[]
>([]);
const waitingStock = computed(() => pending.value.filter((event) => event.payload?.waitingForStock));
const actionable = computed(() => pending.value.filter((event) => !event.payload?.waitingForStock));
const loading = ref(false);
const starting = ref(false);
const readError = ref('');
const error = computed(
    () => readError.value || selected.value?.box.error || (job.value?.status === 'failed' ? job.value.error : ''),
);
let version = 0;
async function refresh() {
    const service = props.service;
    if (!jobs[service]) return;
    const current = ++version;
    loading.value = true;
    try {
        const response = await axios.get<typeof pending.value>(`/api/marketplace-loss/${service}/prices`);
        if (current !== version || service !== props.service) return;
        if (!Array.isArray(response.data)) throw new Error('Некорректный ответ очереди');
        pending.value = response.data;
        readError.value = '';
    } catch (e: any) {
        if (current === version && service === props.service)
            readError.value = e.response?.data?.message || 'Не удалось прочитать очередь обновления цен';
    } finally {
        if (current === version) loading.value = false;
    }
}
async function run() {
    const service = props.service;
    if (!jobs[service] || starting.value || job.value?.status === 'running') return;
    starting.value = true;
    try {
        await jobs[service].start(
            async () => (await axios.post<JobState<QueueResult>>(`/api/marketplace-loss/${service}/prices`)).data,
        );
    } finally {
        starting.value = false;
    }
}
watch(
    () => `${props.service}:${props.revision}`,
    () => {
        ++version;
        pending.value = [];
        readError.value = '';
        loading.value = false;
        if (selected.value) void Promise.all([refresh(), selected.value.attach()]);
    },
    { immediate: true },
);
watch(
    () => `${props.service}:${job.value?.id}:${job.value?.status}`,
    (value) => {
        if (value.endsWith(':done') || value.endsWith(':failed')) void refresh();
    },
);
</script>
<template>
    <section v-if="selected" class="my-4" data-loss-price-queue>
        <h3 class="mb-2">Обновление цен и акций после статистики</h3>
        <p>Задания сохраняются в базе и переживают перезапуск. При ошибке остаются для повторной попытки.</p>
        <JobProgress v-if="job" :job="job" done-text="Проход очереди завершён" />
        <v-alert v-if="error" type="error" class="my-2">{{ error }}</v-alert>
        <p v-if="loading" role="status">Чтение очереди цен…</p>
        <p v-if="job?.status === 'done' && job.result">
            В последнем проходе: обработано {{ job.result.processed }}, завершено {{ job.result.completed }}, отправлено
            цен {{ job.result.sent }}. Ожидают остатка {{ job.result.waitingStock ?? 0 }}.
        </p>
        <p v-if="!loading && !readError">Незавершённых заданий: {{ pending.length }}.</p>
        <v-alert v-if="waitingStock.length" type="info" class="my-2" data-waiting-stock>
            Ожидают остатка: {{ waitingStock.length }}. Расчёт продолжится после появления товара.
            <details>
                <summary>Показать товары</summary>
                <p v-for="event in waitingStock" :key="event.extId">
                    {{ event.payload?.offerId ?? event.extId }}: ожидание остатка.
                </p>
            </details>
        </v-alert>
        <v-alert v-if="actionable.length" type="warning" class="my-2">
            Эти обновления ещё не завершены. Причины и число попыток указаны ниже.
            <details>
                <summary>Показать задания</summary>
                <p v-for="event in actionable" :key="event.extId">
                    {{ event.payload?.offerId ?? event.extId }}: {{ event.payload?.lastError ?? 'Ожидает обработки' }};
                    попыток {{ event.payload?.attempts ?? 0 }}.
                </p>
            </details>
        </v-alert>
        <v-btn class="me-2" :disabled="starting || job?.status === 'running'" :loading="starting" @click="run"
            >Обработать очередь цен</v-btn
        >
        <v-btn :disabled="loading" @click="refresh">Обновить очередь</v-btn>
    </section>
</template>
