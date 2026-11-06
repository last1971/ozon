<script setup lang="ts">
import { computed, onMounted } from 'vue';
import JobProgress from './JobProgress.vue';
import { useJob } from '@/composable/useJob';
const props = defineProps<{ market: 'ozon' | 'wb' }>();
interface Report {
    total: number;
    accepted: number;
    unchanged: number;
    skipped: number;
    failed: number;
    rows: { offer_id: string; status: string; reason?: string }[];
    warnings: { message: string; count: number; examples: string[] }[];
}
const job = useJob<Report>(`price-bulk:${props.market}`, { followLatest: true });
const report = computed(() => job.box.job?.result);
const details = computed(() => report.value?.rows.filter((r) => r.status === 'error' || r.status === 'skipped') ?? []);
const reasons: Record<string, string> = {
    'no-base': 'Нет базы для расчёта',
    'no-free-stock': 'Нет свободного остатка',
    'not-in-stock': 'Нет товара на складе',
};
onMounted(job.attach);
</script>
<template>
    <div class="pa-2">
        <v-btn variant="text" size="small" @click="job.attach"
            >Итог обновления {{ market.toUpperCase() }} · обновить</v-btn
        >
        <v-alert v-if="job.box.error" type="error" density="compact">{{ job.box.error }}</v-alert>
        <JobProgress v-if="job.box.job" :job="job.box.job" done-text="Обработка завершена">
            <template #title>{{ market.toUpperCase() }} · все цены</template>
        </JobProgress>
        <div v-if="report" class="mt-2">
            Всего: {{ report.total }}. Принято площадкой: {{ report.accepted }}. Уже совпадало: {{ report.unchanged }}.
            Пропущено: {{ report.skipped }}. Ошибок: {{ report.failed }}.
            <div v-if="market === 'wb'">Принято — WB принял задачу. Это ещё не подтверждение применения цен.</div>
            <details v-if="details.length">
                <summary>Ошибки и пропущенные товары</summary>
                <v-table density="compact"
                    ><thead>
                        <tr>
                            <th>Артикул</th>
                            <th>Результат</th>
                            <th>Причина</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in details" :key="row.offer_id">
                            <td>{{ row.offer_id }}</td>
                            <td>{{ row.status === 'error' ? 'Ошибка' : 'Пропущено' }}</td>
                            <td>{{ reasons[row.reason ?? ''] ?? row.reason }}</td>
                        </tr>
                    </tbody>
                </v-table>
            </details>
            <details v-if="report.warnings.length">
                <summary>Предупреждения расчёта</summary>
                <div v-for="warning in report.warnings" :key="warning.message">
                    {{ warning.message }}: {{ warning.count }}. Примеры: {{ warning.examples.join(', ') }}.
                </div>
            </details>
        </div>
    </div>
</template>
