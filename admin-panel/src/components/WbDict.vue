<script setup lang="ts">
import { wbDictStore, WB_DICT_CATEGORIES_JOB, WB_DICT_TNVED_JOB, type WbDictReport } from "@/stores/wbDict";
import { useJob } from "@/composable/useJob";
import { clientId } from "@/axios.config";
import { computed, onMounted, watch } from "vue";
import type { JobState } from "@/contracts/job.state";

const store = wbDictStore();
const categories = useJob<WbDictReport>(WB_DICT_CATEGORIES_JOB);
const tnved = useJob<WbDictReport>(WB_DICT_TNVED_JOB);
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

const running = (j: JobState | null) => j?.status === 'running';
const whose = (j: { clientId?: string }) => (j.clientId && j.clientId === me ? 'моя' : 'с другого компьютера');
const progressText = (j: JobState) => {
    const p = j.progress;
    const phase = p.phase ?? '…';
    return p.total ? `${phase}: ${p.done} из ${p.total}` : p.done ? `${phase}: ${p.done}` : phase;
};
const progressPercent = (j: JobState) => (j.progress.total ? Math.round((j.progress.done / j.progress.total) * 100) : undefined);
const reportText = (r: WbDictReport | undefined) => {
    if (!r) return 'готово';
    if (r.categories !== undefined) return `готово: предметов ${r.categories}`;
    return `готово: предметов ${r.subjects ?? 0}, записано ${r.saved ?? 0}, пустых ${r.empty ?? 0}, не отдано ${r.failed ?? 0}, кодов в карте ${r.codes ?? 0}`;
};

const anyRunning = computed(() => running(categories.box.job) || running(tnved.box.job));
</script>

<template>
    <v-container fluid class="pa-0">
        <v-alert v-if="store.errorMessage" type="error" closable class="mb-4" @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>
        <v-alert v-for="b in [categories.box, tnved.box]" :key="b.job?.id ?? 'x'" v-show="b.error" type="error" closable class="mb-4" @click:close="b.error = ''">
            {{ b.error }}
        </v-alert>

        <!-- Что лежит в базе -->
        <v-row v-if="store.stats" dense class="mb-2">
            <v-col cols="auto"><v-chip color="info" variant="tonal">Предметов ВБ: {{ store.stats.subjects }}</v-chip></v-col>
            <v-col cols="auto"><v-chip color="success" variant="tonal">Со справочником ТН ВЭД: {{ store.stats.withTnved }}</v-chip></v-col>
            <v-col cols="auto"><v-chip color="warning" variant="tonal">Ждут выкачки: {{ store.stats.stale }}</v-chip></v-col>
        </v-row>

        <v-row dense align="center">
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
                <v-checkbox v-model="store.all" label="Все предметы заново" density="compact" hide-details :disabled="anyRunning" />
            </v-col>
        </v-row>

        <!-- Ход задач: категории и ТН ВЭД -->
        <template v-for="[label, box] in [['категории', categories.box], ['ТН ВЭД', tnved.box]] as const" :key="label">
            <v-card v-if="box.job" class="mt-4" variant="tonal" :color="box.job.status === 'failed' ? 'error' : running(box.job) ? 'primary' : 'success'">
                <v-card-text>
                    <div class="d-flex align-center mb-2">
                        <v-icon :icon="running(box.job) ? 'mdi-progress-clock' : box.job.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check-circle'" class="me-2" />
                        <span class="font-weight-medium">
                            {{ label }} · {{ whose(box.job) }} ·
                            {{ running(box.job) ? progressText(box.job) : box.job.status === 'failed' ? `ошибка: ${box.job.error}` : reportText(box.job.result) }}
                        </span>
                    </div>
                    <v-progress-linear v-if="running(box.job)" :model-value="progressPercent(box.job)" :indeterminate="progressPercent(box.job) === undefined" height="8" rounded />
                    <div v-if="Object.keys(box.job.progress.counters).length" class="mt-2 text-body-2">
                        <span v-for="(v, k) in box.job.progress.counters" :key="k" class="me-4">{{ k }}: {{ v }}</span>
                    </div>
                </v-card-text>
            </v-card>
            <div v-if="box.others.length" class="mt-2 text-body-2 text-medium-emphasis">
                <div v-for="o in box.others" :key="o.id">
                    <v-icon :icon="o.status === 'running' ? 'mdi-progress-clock' : o.status === 'failed' ? 'mdi-alert-circle' : 'mdi-check'" size="small" class="me-1" />
                    {{ label }} · {{ whose(o) }} · {{ o.status === 'running' ? progressText(o) : o.status }} · {{ new Date(o.startedAt).toLocaleTimeString() }}
                </div>
            </div>
        </template>

        <!-- Поиск предметов по коду ТН ВЭД -->
        <v-row dense align="center" class="mt-6">
            <v-col cols="3">
                <v-text-field v-model="store.tnved" label="Код ТН ВЭД" density="compact" hide-details @keyup.enter="store.search()" />
            </v-col>
            <v-col cols="auto">
                <v-btn color="secondary" prepend-icon="mdi-magnify" :loading="store.isSearching" @click="store.search()">Где проходит</v-btn>
            </v-col>
            <v-col v-if="store.lookup" cols="auto" class="text-body-2 text-medium-emphasis">
                {{ store.lookup.tnved }} · {{ MATCH[store.lookup.match] }} · предметов: {{ store.lookup.subjects.length }}
            </v-col>
        </v-row>

        <v-card v-if="store.lookup && store.lookup.subjects.length" class="mt-4" variant="outlined">
            <v-table density="compact" hover>
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
                    <tr v-for="s in store.lookup.subjects" :key="s.id">
                        <td>{{ s.name }}</td>
                        <td>{{ s.parentName }}</td>
                        <td>{{ s.id }}</td>
                        <td>{{ s.commission }}</td>
                        <td><v-icon :icon="s.isKiz ? 'mdi-check' : 'mdi-minus'" size="small" /></td>
                    </tr>
                </tbody>
            </v-table>
        </v-card>
    </v-container>
</template>

<style scoped>

</style>
