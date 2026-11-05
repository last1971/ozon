<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { isAxiosError } from 'axios';
import axios from '@/axios.config';

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
const cards: { kind: Kind; title: string; endpoint: string }[] = [
    { kind: 'commissions', title: 'Комиссии FBO / FBS', endpoint: 'import-commissions' },
    { kind: 'logistics', title: 'Доставка FBO / FBS', endpoint: 'import-logistics' },
];
const sources = ref<Source[]>([]);
const files = ref<Record<Kind, File | File[] | null>>({ commissions: null, logistics: null });
const busy = ref(false);
const error = ref('');
const result = ref('');
const missing = ref<{ id: number; name: string }[]>([]);
const retired = ref<{ id: number; name: string }[]>([]);
const source = (kind: Kind) => sources.value.find((s) => s.kind === kind);
const when = (value?: string | null) => (value ? new Date(value).toLocaleString('ru-RU') : '—');
const errorText = (e: unknown) => {
    if (isAxiosError(e)) {
        const message = e.response?.data?.message;
        return Array.isArray(message)
            ? message.join('; ')
            : typeof message === 'string'
              ? message
              : 'Не удалось выполнить запрос. Проверьте подключение.';
    }
    return 'Не удалось выполнить запрос.';
};
async function refresh() {
    const { data } = await axios.get<Source[]>('/api/ozon-category/tariffs');
    sources.value = data;
}
async function upload(card: (typeof cards)[number]) {
    const selected = files.value[card.kind];
    const file = Array.isArray(selected) ? selected[0] : selected;
    if (!file) return;
    busy.value = true;
    error.value = '';
    result.value = '';
    missing.value = [];
    retired.value = [];
    try {
        const form = new FormData();
        form.append('file', file);
        const { data } = await axios.post(`/api/ozon-category/${card.endpoint}`, form);
        result.value =
            card.kind === 'commissions'
                ? `Комиссии сохранены: ${data.updated} типов товаров из ${data.rows} строк файла.`
                : `Доставка сохранена: ${data.routeRates} ставок по маршрутам, ${data.defaultRates} ставок по умолчанию.`;
        missing.value = data.missingTypes || [];
        retired.value = data.retiredTypes || [];
        files.value[card.kind] = null;
        try {
            await refresh();
        } catch (e) {
            error.value = `Файл сохранён, но сведения на экране не обновились. ${errorText(e)}`;
        }
    } catch (e) {
        error.value = errorText(e);
    } finally {
        busy.value = false;
    }
}
onMounted(async () => {
    try {
        await refresh();
    } catch (e) {
        error.value = errorText(e);
    }
});
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
