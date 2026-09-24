<script setup lang="ts">
import { tnvedSyncStore, TNVED_SYNC_JOB, type TnvedSyncReport } from "@/stores/tnvedSync";
import MarketplaceSelect from "@/components/MarketplaceSelect.vue";
import { useJob } from "@/composable/useJob";
import { clientId } from "@/axios.config";
import { computed, onMounted, ref, watch } from "vue";

const store = tnvedSyncStore();
const { box, start, attach, clear } = useJob<TnvedSyncReport>(TNVED_SYNC_JOB);
const confirmWrite = ref(false);
const confirmReset = ref(false);
const me = clientId();

onMounted(attach);

// Отчёт привязан к маркетплейсу: сменили — старый отчёт не годится, кнопка «Записать» гаснет.
watch(() => store.form.market, () => clear());

const job = computed(() => box.job);
const running = computed(() => job.value?.status === 'running');
const report = computed(() => (job.value?.status === 'done' ? job.value.result ?? null : null));
/** Записывать можно только после проверки того же маркетплейса, и только если есть что править. */
const canWrite = computed(() => !!report.value && !report.value.apply && report.value.toFix.length > 0);

const progressText = computed(() => {
    const p = job.value?.progress;
    if (!p) return '';
    const phase = p.phase ?? '…';
    return p.total ? `${phase}: ${p.done} из ${p.total}` : p.done ? `${phase}: ${p.done}` : phase;
});
const progressPercent = computed(() => {
    const p = job.value?.progress;
    return p?.total ? Math.round((p.done / p.total) * 100) : undefined;
});

const marketOf = (j: { params: Record<string, unknown> }) => String(j.params.market ?? '').toUpperCase();
const whose = (j: { clientId?: string }) => (j.clientId && j.clientId === me ? 'моя' : 'с другого компьютера');

async function check() {
    await start(() => store.start(false));
}
async function write() {
    confirmWrite.value = false;
    await start(() => store.start(true));
}
async function resetProgress() {
    confirmReset.value = false;
    await store.resetProgress();
}
</script>

<template>
    <v-container fluid class="pa-0">
        <v-alert v-if="store.errorMessage" type="error" closable class="mb-4" @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>
        <v-alert v-if="box.error" type="error" closable class="mb-4" @click:close="box.error = ''">
            {{ box.error }}
        </v-alert>

        <v-form>
            <v-row dense align="center">
                <v-col cols="2">
                    <marketplace-select v-model="store.form.market" />
                </v-col>
                <v-col cols="2">
                    <v-text-field v-model="store.form.offer" label="Код товара (пусто — вся база)" density="compact" />
                </v-col>
                <v-col cols="2">
                    <v-text-field v-model.number="store.form.limit" label="Следующие N товаров" type="number" density="compact" />
                </v-col>
                <v-col cols="auto">
                    <v-checkbox v-model="store.form.onlyNew" label="Только необработанные" density="compact" hide-details />
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        color="primary"
                        prepend-icon="mdi-magnify"
                        :loading="running"
                        :disabled="running"
                        @click="check"
                    >
                        Проверить
                    </v-btn>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        color="warning"
                        prepend-icon="mdi-upload"
                        :disabled="running || !canWrite"
                        @click="confirmWrite = true"
                    >
                        Записать
                    </v-btn>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        variant="text"
                        prepend-icon="mdi-restart"
                        :disabled="running || store.isResetting"
                        @click="confirmReset = true"
                    >
                        Сбросить прогресс
                    </v-btn>
                </v-col>
            </v-row>
        </v-form>

        <!-- Ход задачи -->
        <v-card v-if="job" class="mt-4" variant="tonal" :color="job.status === 'failed' ? 'error' : running ? 'primary' : 'success'">
            <v-card-text>
                <div class="d-flex align-center mb-2">
                    <v-icon :icon="running ? 'mdi-progress-clock' : job.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check-circle'" class="me-2" />
                    <span class="font-weight-medium">
                        {{ marketOf(job) }} · {{ job.params.apply ? 'запись' : 'проверка' }} · {{ whose(job) }}
                        · {{ running ? progressText : job.status === 'failed' ? `ошибка: ${job.error}` : 'готово' }}
                    </span>
                </div>
                <v-progress-linear
                    v-if="running"
                    :model-value="progressPercent"
                    :indeterminate="progressPercent === undefined"
                    height="8"
                    rounded
                />
                <div v-if="Object.keys(job.progress.counters).length" class="mt-2 text-body-2">
                    <span v-for="(v, k) in job.progress.counters" :key="k" class="me-4">{{ k }}: {{ v }}</span>
                </div>
            </v-card-text>
        </v-card>

        <!-- Остальные запуски вида: чужие идущие и завершённые за час -->
        <div v-if="box.others.length" class="mt-2 text-body-2 text-medium-emphasis">
            <div v-for="o in box.others" :key="o.id">
                <v-icon :icon="o.status === 'running' ? 'mdi-progress-clock' : o.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check'" size="small" class="me-1" />
                {{ marketOf(o) }} · {{ o.params.apply ? 'запись' : 'проверка' }} · {{ whose(o) }} ·
                {{ o.status === 'running' ? `${o.progress.phase ?? ''} ${o.progress.done}${o.progress.total ? ' из ' + o.progress.total : ''}` : o.status }}
                · {{ new Date(o.startedAt).toLocaleTimeString() }}
            </div>
        </div>

        <v-dialog v-model="confirmReset" max-width="480">
            <v-card>
                <v-card-title>Сбросить прогресс {{ store.form.market.toUpperCase() }}?</v-card-title>
                <v-card-text>
                    Отметки «обработано» будут стёрты, следующий прогон «только необработанные» пойдёт по всей базе.
                    На маркетплейсе ничего не меняется.
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="confirmReset = false">Отмена</v-btn>
                    <v-btn color="error" @click="resetProgress">Сбросить</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="confirmWrite" max-width="480">
            <v-card>
                <v-card-title>Записать на {{ store.form.market.toUpperCase() }}?</v-card-title>
                <v-card-text>
                    Будет записано карточек: {{ report?.toFix.length }}. Карточки ВБ перезаписываются целиком,
                    «до» сохраняется в бэкап на сервере.
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="confirmWrite = false">Отмена</v-btn>
                    <v-btn color="warning" @click="write">Записать</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <template v-if="report">
            <v-row dense class="mt-4">
                <v-col cols="auto">
                    <v-chip color="info" variant="tonal">Товаров: {{ report.checkedGoods }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="info" variant="tonal">Карточек: {{ report.checkedOffers }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="success" variant="tonal">Уже ок: {{ report.alreadyOk }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="warning" variant="tonal">
                        {{ report.apply ? 'Записано' : 'На правку' }}: {{ report.toFix.length }}
                    </v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="error" variant="tonal">Не прошло: {{ report.ambiguous.length }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip variant="tonal">Нет карточки: {{ report.notFoundOnOzon.length }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip variant="tonal">Пропущено обработанных: {{ report.skippedProcessed }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="primary" variant="tonal">Осталось: {{ report.remaining }}</v-chip>
                </v-col>
            </v-row>

            <!-- Что синхронизировалось / что на правку -->
            <v-card class="mt-4" variant="outlined" v-if="report.toFix.length">
                <v-card-title class="text-subtitle-1">
                    {{ report.apply ? 'Записано' : 'На правку' }}
                </v-card-title>
                <v-table density="compact" hover>
                    <thead>
                        <tr>
                            <th>Карточка</th>
                            <th>Название</th>
                            <th>На маркетплейсе</th>
                            <th>У нас</th>
                            <th>Маркировка</th>
                            <th>Причина</th>
                            <th v-if="report.apply">Итог</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="f in report.toFix" :key="f.offer">
                            <td>{{ f.offer }}</td>
                            <td>{{ f.name }}</td>
                            <td>{{ f.current ?? '—' }}</td>
                            <td>{{ f.base }}</td>
                            <td><v-icon :icon="f.markRequired ? 'mdi-check' : 'mdi-minus'" size="small" /></td>
                            <td>{{ f.reason }}</td>
                            <td v-if="report.apply">
                                <v-chip v-if="f.error" color="error" size="small" variant="tonal">{{ f.error }}</v-chip>
                                <v-chip v-else color="success" size="small" variant="tonal">
                                    ок{{ f.taskId ? ` · task ${f.taskId}` : '' }}
                                </v-chip>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </v-card>

            <!-- Что не прошло, с причиной -->
            <v-card class="mt-4" variant="outlined" v-if="report.ambiguous.length">
                <v-card-title class="text-subtitle-1">Не прошло — руками</v-card-title>
                <v-table density="compact" hover>
                    <thead>
                        <tr>
                            <th>Карточка</th>
                            <th>Причина</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="a in report.ambiguous" :key="a.offer">
                            <td>{{ a.offer }}</td>
                            <td>{{ a.reason }}</td>
                        </tr>
                    </tbody>
                </v-table>
            </v-card>

            <v-expansion-panels class="mt-4" v-if="report.notFoundOnOzon.length">
                <v-expansion-panel :title="`Нет карточки на маркетплейсе: ${report.notFoundOnOzon.length}`">
                    <v-expansion-panel-text>{{ report.notFoundOnOzon.join(', ') }}</v-expansion-panel-text>
                </v-expansion-panel>
            </v-expansion-panels>
        </template>
    </v-container>
</template>

<style scoped>

</style>
