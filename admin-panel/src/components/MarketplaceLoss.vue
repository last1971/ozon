<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
import { lossCostLabels as costLabels } from '@/contracts/loss-cost-labels';
import JobProgress from './JobProgress.vue';
import type { JobState } from '@/contracts/job.state';
import type { LossSnapshot, LossRow, LossCostReport } from '@/contracts/marketplace-loss';

const markets = ref<{ service: string; label: string }[]>([]);
const selected = ref('');
const snapshot = ref<LossSnapshot | null>(null);
const readError = ref('');
const loading = ref(false);
const starting = ref(false);
const search = ref('');
const page = ref(1);
const pageSize = 25;
const jobs = Object.fromEntries(
    ['OZON', 'WB', 'YANDEX'].map((service) => [
        service,
        useJob<{ rows: number; excludedGoods?: { goodscode: string; reason: string }[]; financialIssues?: unknown[] }>(
            `loss-recalculate:${service.toLowerCase()}`,
            { followLatest: true },
        ),
    ]),
);
const job = computed(() => jobs[selected.value]?.box.job);
const error = computed(() => readError.value || jobs[selected.value]?.box.error || '');
const busy = computed(() => starting.value || job.value?.status === 'running');
const excluded = computed(() => job.value?.result?.excludedGoods ?? []);
const filtered = computed(() =>
    (snapshot.value?.rows ?? []).filter((r) => r.offerId.includes((search.value ?? '').trim())),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const detail = ref<LossCostReport | null>(null);
const detailLoading = ref('');
let readVersion = 0;
let detailVersion = 0;
const percent = (value: number | null | undefined) =>
    value == null ? 'нет данных' : (value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '%';
const money = (value: number | null | undefined) =>
    value == null ? 'нет данных' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
const when = (value?: string) =>
    value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'нет данных';
const states = {
    MIGRATED: 'Перенесено без исходных количеств',
    NO_SALES: 'Нет продаж',
    READY: 'Рассчитано',
    REVIEW: 'Нужна проверка',
    PARTIAL: 'Неполные данные',
};
function expenseNote(row: LossRow) {
    if (!row.expenses) return 'Расходы ещё не рассчитаны';
    if (!(row.soldUnits! > 0)) return 'Нет продаж: расходы на продажу неизвестны';
    if (
        [row.expenses.paidReturnDelivery, row.expenses.cancellationDelivery, row.expenses.sellerReturnDelivery].some(
            (v) => v === null,
        )
    )
        return 'Есть неизвестные расходы; цена не рассчитывается';
    return '';
}
async function refresh() {
    const service = selected.value;
    if (!service) return;
    const version = ++readVersion;
    loading.value = true;
    try {
        const { data } = await axios.get<LossSnapshot | null>(`/api/marketplace-loss/${service}`);
        if (version !== readVersion || service !== selected.value) return;
        snapshot.value = data;
        readError.value = '';
        page.value = Math.min(page.value, pages.value);
    } catch (e: any) {
        if (version === readVersion && service === selected.value)
            readError.value = e.response?.data?.message || 'Не удалось прочитать статистику';
    } finally {
        if (version === readVersion) loading.value = false;
    }
}
async function recalculate() {
    const service = selected.value;
    if (!service || busy.value) return;
    starting.value = true;
    try {
        await jobs[service].start(
            async () =>
                (await axios.post<JobState<{ rows: number }>>(`/api/marketplace-loss/${service}/recalculate`)).data,
        );
    } finally {
        starting.value = false;
    }
}
async function showCosts(row: LossRow) {
    const service = selected.value;
    const version = ++detailVersion;
    detail.value = null;
    detailLoading.value = row.offerId;
    try {
        const { data } = await axios.get<LossCostReport>(
            `/api/marketplace-loss/${service}/${encodeURIComponent(row.offerId)}/costs`,
        );
        if (version === detailVersion && service === selected.value) detail.value = data;
    } catch (e: any) {
        if (version === detailVersion && service === selected.value)
            detail.value = {
                offerId: row.offerId,
                costs: null,
                error: e.response?.data?.message || 'Не удалось прочитать расходы',
            };
    } finally {
        if (version === detailVersion) detailLoading.value = '';
    }
}
watch(search, () => {
    page.value = 1;
});
watch(selected, async () => {
    ++detailVersion;
    detail.value = null;
    detailLoading.value = '';
    snapshot.value = null;
    readError.value = '';
    search.value = '';
    page.value = 1;
    await Promise.all([refresh(), jobs[selected.value]?.attach()]);
});
// Примитив: обновление объекта job при опросе не запускает повторное чтение снимка.
watch(
    () => `${selected.value}:${job.value?.id}:${job.value?.status}`,
    (value) => {
        if (value.endsWith(':done')) {
            ++detailVersion;
            detail.value = null;
            detailLoading.value = '';
            void refresh();
        }
    },
);
onMounted(async () => {
    try {
        markets.value = (await axios.get<typeof markets.value>('/api/marketplace-loss')).data;
        selected.value = markets.value[0]?.service ?? '';
    } catch {
        readError.value = 'Не удалось загрузить список площадок';
    }
});
</script>

<template>
    <section :aria-busy="loading">
        <h2 class="mb-3">Возвраты и брак</h2>
        <v-select v-model="selected" :items="markets" item-title="label" item-value="service" label="Площадка" />
        <p>90 завершённых дней по Москве, без сегодняшнего дня. Отмены повторно не вычитаются из продаж.</p>
        <p>Проценты и суммы относятся только к выбранной площадке и фасовке. Нет данных — не означает 0.</p>
        <v-btn class="my-3 me-3" :disabled="!selected || loading" @click="refresh">Обновить сведения</v-btn>
        <v-btn class="my-3" :disabled="!selected || busy" :loading="starting" @click="recalculate"
            >Пересчитать статистику</v-btn
        >
        <p>Пересчёт сохраняет статистику. Отправка цен этой кнопкой не запускается.</p>
        <JobProgress v-if="job" :job="job" done-text="Статистика сохранена" />
        <v-alert v-if="error" type="error" class="my-3">{{ error }}</v-alert>
        <v-alert v-if="job?.status === 'failed'" type="error" class="my-3">
            Пересчёт не завершён: {{ job.error }}. Ниже — последний сохранённый снимок.
        </v-alert>
        <p v-if="loading" role="status">Чтение статистики…</p>
        <p v-if="!selected && !error && !loading">Подключённых площадок для статистики нет.</p>
        <template v-if="snapshot">
            <p>
                Период:
                {{
                    snapshot.period
                        ? `${snapshot.period.from} — ${snapshot.period.to} (не включая)`
                        : 'неизвестен — перенесены старые проценты'
                }}.
            </p>
            <p>Рассчитано: {{ when(snapshot.calculatedAt) }} (Москва).</p>
            <v-alert v-if="snapshot.preliminary" type="warning" class="my-3">
                Данные предварительные. Неизвестные возвраты и расходы не подменяются нулём.
            </v-alert>
            <p v-if="job?.result?.financialIssues?.length">
                Замечаний финансовой сверки: {{ job.result.financialIssues.length }}. Неизвестные суммы отмечены в
                строках.
            </p>
            <v-text-field v-model="search" label="Поиск по артикулу" clearable @click:clear="search = ''" />
            <p>Найдено: {{ filtered.length }}. Количества — в упаковках своей фасовки.</p>
            <v-table>
                <thead>
                    <tr>
                        <th>Артикул</th>
                        <th>Продано</th>
                        <th>Оплаченные возвраты</th>
                        <th>Списано</th>
                        <th>Возвраты</th>
                        <th>Брак</th>
                        <th>Статус</th>
                        <th>Расходы, ₽</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.offerId">
                        <td>{{ row.offerId }}</td>
                        <td>{{ row.soldUnits ?? 'нет данных' }}</td>
                        <td>{{ row.returnedUnits ?? 'нет данных' }}</td>
                        <td>{{ row.writtenOffUnits ?? 'нет данных' }}</td>
                        <td>
                            {{ percent(row.returnRate) }}
                            <small v-if="selected === 'OZON' && row.appliedReturnRate != null" class="d-block"
                                >В цене: {{ percent(row.appliedReturnRate) }}</small
                            >
                        </td>
                        <td>{{ percent(row.defectRate) }}</td>
                        <td>
                            {{ states[row.state] }}
                            <div v-for="warning in row.warnings" :key="warning">{{ warning }}</div>
                            <div v-if="expenseNote(row)" class="text-warning">{{ expenseNote(row) }}</div>
                            <small>Расчёт: {{ when(row.calculatedAt) }}</small>
                        </td>
                        <td>
                            <details>
                                <summary>За 90 дней</summary>
                                <p>
                                    Доставка оплаченных возвратов:
                                    {{
                                        row.expenses && row.expenses.paidReturnDelivery === undefined
                                            ? 'по тарифу Ozon; см. расходы на продажу'
                                            : money(row.expenses?.paidReturnDelivery)
                                    }}
                                </p>
                                <p>Отказы: {{ money(row.expenses?.cancellationDelivery) }}</p>
                                <p>Возврат продавцу: {{ money(row.expenses?.sellerReturnDelivery) }}</p>
                                <p>
                                    Подтверждённое возмещение брака:
                                    {{ money(row.expenses?.confirmedDefectCompensation) }}
                                </p>
                            </details>
                            <v-btn
                                size="small"
                                :loading="detailLoading === row.offerId"
                                :disabled="Boolean(detailLoading)"
                                @click="showCosts(row)"
                                >На одну продажу</v-btn
                            >
                        </td>
                    </tr>
                </tbody>
            </v-table>
            <v-pagination v-if="pages > 1" v-model="page" :length="pages" :total-visible="7" />
            <p v-if="!filtered.length">Товаров в снимке по этому поиску нет.</p>
        </template>
        <p v-else-if="selected && !loading && !error">Статистика ещё не рассчитана. Запустите пересчёт.</p>
        <details v-if="excluded.length" class="my-3">
            <summary>Исключены товары: {{ excluded.length }}</summary>
            <p v-for="item in excluded" :key="item.goodscode">{{ item.goodscode }}: {{ item.reason }}</p>
        </details>
        <v-card v-if="detail" variant="outlined" class="pa-3 my-3" data-loss-costs>
            <h3>Расходы на одну продажу — {{ detail.offerId }}</h3>
            <p>Статистика рассчитана: {{ when(detail.calculatedAt) }} (Москва).</p>
            <v-alert v-if="detail.error" type="warning">{{ detail.error }}</v-alert>
            <template v-if="detail.costs">
                <p v-if="detail.price !== undefined">
                    При расчётной минимальной цене {{ money(detail.price) }}, {{ detail.scheme?.toUpperCase() }}.
                </p>
                <p v-for="(label, key) in costLabels" :key="key">{{ label }}: {{ money(detail.costs[key]) }}</p>
                <p>Резерв брака уже уменьшен на учтённое возмещение. Повторно его вычитать не нужно.</p>
            </template>
        </v-card>
    </section>
</template>
