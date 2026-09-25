<script setup lang="ts">
import { dictStore, DICT_CATEGORIES_JOB, DICT_TNVED_JOB, type DictReport } from "@/stores/dict";
import MarketplaceSelect from "@/components/MarketplaceSelect.vue";
import { useJob } from "@/composable/useJob";
import { clientId } from "@/axios.config";
import { computed, onMounted, watch } from "vue";
import type { JobState } from "@/contracts/job.state";

const store = dictStore();
const categories = useJob<DictReport>(DICT_CATEGORIES_JOB);
const tnved = useJob<DictReport>(DICT_TNVED_JOB);
const me = clientId();

onMounted(() => Promise.all([categories.attach(), tnved.attach(), store.loadStats()]));

// Задача закончилась — цифры в шапке устарели.
watch(() => [categories.box.job?.status, tnved.box.job?.status], () => store.loadStats());

const MATCH: Record<string, string> = {
    exact: 'точное совпадение',
    prefix6: 'по первым 6 знакам',
    prefix4: 'по первым 4 знакам',
    none: 'нет ни одного предмета',
};

const jobs = [
    { label: 'категории', box: categories.box },
    { label: 'ТН ВЭД', box: tnved.box },
];

const running = (j: JobState | null) => j?.status === 'running';
const marketOf = (j: { params?: Record<string, unknown>; market?: string }) => String(j.params?.market ?? j.market ?? '').toUpperCase();
const whose = (j: { clientId?: string }) => (j.clientId && j.clientId === me ? 'моя' : 'с другого компьютера');
const progressText = (j: JobState) => {
    const p = j.progress;
    const phase = p.phase ?? '…';
    return p.total ? `${phase}: ${p.done} из ${p.total}` : p.done ? `${phase}: ${p.done}` : phase;
};
const progressPercent = (j: JobState) => (j.progress.total ? Math.round((j.progress.done / j.progress.total) * 100) : undefined);
const reportText = (r: DictReport | undefined) => {
    if (!r) return 'готово';
    if (r.categories !== undefined) return `готово: предметов ${r.categories}`;
    return `готово: предметов ${r.subjects ?? 0}, записано ${r.saved ?? 0}, пустых ${r.empty ?? 0}, не отдано ${r.failed ?? 0}, кодов в карте ${r.codes ?? 0}`;
};

const anyRunning = computed(() => running(categories.box.job) || running(tnved.box.job));
const statsOfMarket = computed(() => store.stats.find((s) => s.market === store.form.market) ?? null);
</script>

<template>
    <v-container fluid class="pa-0">
        <v-alert v-if="store.errorMessage" type="error" closable class="mb-4" @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>
        <template v-for="j in jobs" :key="j.label">
            <v-alert v-if="j.box.error" type="error" closable class="mb-4" @click:close="j.box.error = ''">
                {{ j.box.error }}
            </v-alert>
        </template>

        <!-- Обновление: по выбранному рынку -->
        <v-row dense align="center">
            <v-col cols="2">
                <marketplace-select v-model="store.form.market" />
            </v-col>
            <v-col cols="auto">
                <v-btn color="primary" prepend-icon="mdi-shape" :loading="running(categories.box.job)" :disabled="anyRunning" @click="categories.start(() => store.startCategories())">
                    Обновить категории
                </v-btn>
            </v-col>
            <v-col cols="auto">
                <v-btn color="primary" prepend-icon="mdi-barcode" :loading="running(tnved.box.job)" :disabled="anyRunning" @click="tnved.start(() => store.startTnved())">
                    Обновить ТН ВЭД
                </v-btn>
            </v-col>
            <v-col cols="auto">
                <v-checkbox v-model="store.form.all" label="Все предметы заново" density="compact" hide-details :disabled="anyRunning" />
            </v-col>
        </v-row>

        <!-- Что лежит в базе по выбранному рынку -->
        <v-row v-if="statsOfMarket" dense class="mt-2">
            <v-col cols="auto"><v-chip color="info" variant="tonal">Предметов: {{ statsOfMarket.subjects }}</v-chip></v-col>
            <v-col cols="auto"><v-chip color="success" variant="tonal">Со справочником ТН ВЭД: {{ statsOfMarket.withTnved }}</v-chip></v-col>
            <v-col cols="auto"><v-chip color="warning" variant="tonal">Ждут выкачки: {{ statsOfMarket.stale }}</v-chip></v-col>
        </v-row>

        <!-- Ход задач: категории и ТН ВЭД -->
        <template v-for="j in jobs" :key="j.label">
            <v-card v-if="j.box.job" class="mt-4" variant="tonal" :color="j.box.job.status === 'failed' ? 'error' : running(j.box.job) ? 'primary' : 'success'">
                <v-card-text>
                    <div class="d-flex align-center mb-2">
                        <v-icon :icon="running(j.box.job) ? 'mdi-progress-clock' : j.box.job.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check-circle'" class="me-2" />
                        <span class="font-weight-medium">
                            {{ marketOf(j.box.job) }} · {{ j.label }} · {{ whose(j.box.job) }} ·
                            {{ running(j.box.job) ? progressText(j.box.job) : j.box.job.status === 'failed' ? `ошибка: ${j.box.job.error}` : reportText(j.box.job.result) }}
                        </span>
                    </div>
                    <v-progress-linear v-if="running(j.box.job)" :model-value="progressPercent(j.box.job)" :indeterminate="progressPercent(j.box.job) === undefined" height="8" rounded />
                    <div v-if="Object.keys(j.box.job.progress.counters).length" class="mt-2 text-body-2">
                        <span v-for="(v, k) in j.box.job.progress.counters" :key="k" class="me-4">{{ k }}: {{ v }}</span>
                    </div>
                </v-card-text>
            </v-card>
            <div v-if="j.box.others.length" class="mt-2 text-body-2 text-medium-emphasis">
                <div v-for="o in j.box.others" :key="o.id">
                    <v-icon :icon="o.status === 'running' ? 'mdi-progress-clock' : o.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check'" size="small" class="me-1" />
                    {{ marketOf(o) }} · {{ j.label }} · {{ whose(o) }} · {{ o.status === 'running' ? progressText(o) : o.status }} · {{ new Date(o.startedAt).toLocaleTimeString() }}
                </div>
            </div>
        </template>

        <!-- Поиск предметов по коду ТН ВЭД — по всем рынкам сразу, колонка на рынок -->
        <v-row dense align="center" class="mt-6">
            <v-col cols="3">
                <v-text-field v-model="store.tnved" label="Код ТН ВЭД" density="compact" hide-details @keyup.enter="store.search()" />
            </v-col>
            <v-col cols="auto">
                <v-btn color="secondary" prepend-icon="mdi-magnify" :loading="store.isSearching" @click="store.search()">Где проходит</v-btn>
            </v-col>
        </v-row>

        <v-row v-if="store.lookup.length" dense class="mt-2">
            <v-col v-for="l in store.lookup" :key="l.market" cols="12" :md="12 / store.lookup.length">
                <v-card variant="outlined">
                    <v-card-title class="text-subtitle-1">
                        {{ marketOf(l) }} · {{ MATCH[l.match] }} · предметов: {{ l.subjects.length }}
                    </v-card-title>
                    <v-table v-if="l.subjects.length" density="compact" hover>
                        <thead>
                            <tr>
                                <th>Предмет</th>
                                <th>Категория</th>
                                <th>ID</th>
                                <th>Комиссия, %</th>
                                <th>Маркировка</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in l.subjects" :key="s.id">
                                <td>{{ s.name }}</td>
                                <td>{{ s.parentName }}</td>
                                <td>{{ s.id }}</td>
                                <td>{{ s.commission ?? '—' }}</td>
                                <td><v-icon :icon="s.isKiz ? 'mdi-check' : 'mdi-minus'" size="small" /></td>
                            </tr>
                        </tbody>
                    </v-table>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<style scoped>

</style>
