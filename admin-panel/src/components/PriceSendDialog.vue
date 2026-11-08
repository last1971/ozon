<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
import JobProgress from './JobProgress.vue';
interface Entry {
    service: string;
    prices: { offer_id: string; min_price: string; price: string; old_price: string }[];
    discount?: number;
    warnings?: string[];
    error?: string;
    response?: unknown;
}
interface Review {
    token?: string;
    expiresAt?: number;
    entries: Entry[];
    sent?: boolean;
}
const props = defineProps<{ offerId: string; settingsKey: string; disabled: boolean }>();
const emit = defineEmits<{ (e: 'sent'): void }>();
const open = ref(false);
const job = useJob<Review>(`price-review:${props.offerId}`);
const result = computed(() => (job.box.job?.status === 'done' ? job.box.job.result : undefined));
const running = computed(() => job.box.job?.status === 'running');
const preparedKey = ref('');
const canSend = computed(
    () =>
        !props.disabled &&
        !job.box.error &&
        preparedKey.value === props.settingsKey &&
        !!result.value?.token &&
        result.value.entries.some((e) => !e.error && e.prices.length) &&
        !running.value,
);
const money = (v: string) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
async function prepare() {
    preparedKey.value = props.settingsKey;
    open.value = true;
    await job.start(async () => (await axios.post('/api/price/review', { offerId: props.offerId })).data);
}
async function send() {
    if (!canSend.value) return;
    const token = result.value!.token;
    await job.start(async () => (await axios.post('/api/price/review/send', { token })).data);
}
watch(
    () => result.value?.sent,
    (value) => {
        if (value) emit('sent');
    },
);
</script>
<template>
    <v-btn :disabled="disabled || running" @click="prepare">Отправить цены…</v-btn>
    <v-dialog v-model="open" max-width="1000" :persistent="running">
        <v-card title="Проверка перед отправкой цен">
            <v-card-text>
                <p>
                    Товар {{ offerId }}. Отправятся только перечисленные ниже суммы. Настройки товара эта операция не
                    сохраняет.
                </p>
                <JobProgress v-if="job.box.job" :job="job.box.job" />
                <v-alert v-if="job.box.error" type="error">{{ job.box.error }}</v-alert>
                <v-alert v-if="preparedKey !== settingsKey || disabled" type="warning"
                    >Настройки изменились. Сохраните их и подготовьте цены заново.</v-alert
                >
                <template v-if="result">
                    <p v-if="result.expiresAt">
                        Предпросмотр действует до {{ new Date(result.expiresAt).toLocaleTimeString('ru-RU') }}.
                    </p>
                    <p v-if="result.sent">Запросы завершены. Проверьте ответы площадок ниже.</p>
                    <div v-for="entry in result.entries" :key="entry.service" class="my-4">
                        <h3>{{ entry.service.toUpperCase() }}</h3>
                        <v-alert v-for="warning in entry.warnings" :key="warning" type="warning">{{ warning }}</v-alert>
                        <v-alert v-if="entry.error" type="warning">{{ entry.error }}</v-alert>
                        <v-table v-if="entry.prices.length">
                            <thead>
                                <tr>
                                    <th>Артикул</th>
                                    <th>Минимальная</th>
                                    <th>Обычная</th>
                                    <th>До скидки</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="p in entry.prices" :key="p.offer_id">
                                    <td>{{ p.offer_id }}</td>
                                    <td>{{ money(p.min_price) }}</td>
                                    <td>{{ money(p.price) }}</td>
                                    <td>{{ money(p.old_price) }}</td>
                                </tr>
                            </tbody>
                        </v-table>
                        <p v-if="entry.service === 'wb' && entry.discount !== undefined">
                            ВБ: отправляется цена «до скидки» и скидка {{ entry.discount }}% до минимальной.
                        </p>
                        <p v-if="entry.service === 'avito'">Авито: отправляется минимальная цена.</p>
                        <p v-if="entry.service === 'ozon'">
                            Ozon: минимальная — ограничение, обычная — цена, до скидки — зачёркнутая цена. Автоакции
                            включаются, ценовая стратегия выключается. Цена покупателю зависит от акций.
                        </p>
                        <details v-if="entry.response !== undefined">
                            <summary>Ответ площадки</summary>
                            <pre class="text-body-2" style="white-space: pre-wrap">{{
                                JSON.stringify(entry.response, null, 2)
                            }}</pre>
                        </details>
                    </div>
                </template>
            </v-card-text>
            <v-card-actions
                ><v-btn :disabled="running" @click="open = false">Закрыть</v-btn
                ><v-btn v-if="!result?.sent" color="primary" :disabled="!canSend" @click="send"
                    >Подтвердить отправку этих цен</v-btn
                ></v-card-actions
            >
        </v-card>
    </v-dialog>
</template>
