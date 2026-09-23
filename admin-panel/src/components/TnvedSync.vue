<script setup lang="ts">
import { tnvedSyncStore } from "@/stores/tnvedSync";
import MarketplaceSelect from "@/components/MarketplaceSelect.vue";
import { ref, watch } from "vue";

const store = tnvedSyncStore();
const confirmWrite = ref(false);
const confirmReset = ref(false);

// Отчёт привязан к маркетплейсу: сменили — старый отчёт не годится, кнопка «Записать» гаснет.
watch(() => store.form.market, () => store.clear());

async function write() {
    confirmWrite.value = false;
    await store.write();
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
                        :loading="store.isLoading"
                        :disabled="store.isLoading"
                        @click="store.check()"
                    >
                        Проверить
                    </v-btn>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        color="warning"
                        prepend-icon="mdi-upload"
                        :disabled="store.isLoading || !store.canWrite"
                        @click="confirmWrite = true"
                    >
                        Записать
                    </v-btn>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        variant="text"
                        prepend-icon="mdi-restart"
                        :disabled="store.isLoading"
                        @click="confirmReset = true"
                    >
                        Сбросить прогресс
                    </v-btn>
                </v-col>
            </v-row>
        </v-form>

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
                    Будет записано карточек: {{ store.report?.toFix.length }}. Карточки ВБ перезаписываются целиком,
                    «до» сохраняется в бэкап на сервере.
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="confirmWrite = false">Отмена</v-btn>
                    <v-btn color="warning" @click="write">Записать</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <template v-if="store.report">
            <v-row dense class="mt-4">
                <v-col cols="auto">
                    <v-chip color="info" variant="tonal">Товаров: {{ store.report.checkedGoods }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="info" variant="tonal">Карточек: {{ store.report.checkedOffers }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="success" variant="tonal">Уже ок: {{ store.report.alreadyOk }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="warning" variant="tonal">
                        {{ store.report.apply ? 'Записано' : 'На правку' }}: {{ store.report.toFix.length }}
                    </v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="error" variant="tonal">Не прошло: {{ store.report.ambiguous.length }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip variant="tonal">Нет карточки: {{ store.report.notFoundOnOzon.length }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip variant="tonal">Пропущено обработанных: {{ store.report.skippedProcessed }}</v-chip>
                </v-col>
                <v-col cols="auto">
                    <v-chip color="primary" variant="tonal">Осталось: {{ store.report.remaining }}</v-chip>
                </v-col>
            </v-row>

            <!-- Что синхронизировалось / что на правку -->
            <v-card class="mt-4" variant="outlined" v-if="store.report.toFix.length">
                <v-card-title class="text-subtitle-1">
                    {{ store.report.apply ? 'Записано' : 'На правку' }}
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
                            <th v-if="store.report.apply">Итог</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="f in store.report.toFix" :key="f.offer">
                            <td>{{ f.offer }}</td>
                            <td>{{ f.name }}</td>
                            <td>{{ f.current ?? '—' }}</td>
                            <td>{{ f.base }}</td>
                            <td><v-icon :icon="f.markRequired ? 'mdi-check' : 'mdi-minus'" size="small" /></td>
                            <td>{{ f.reason }}</td>
                            <td v-if="store.report.apply">
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
            <v-card class="mt-4" variant="outlined" v-if="store.report.ambiguous.length">
                <v-card-title class="text-subtitle-1">Не прошло — руками</v-card-title>
                <v-table density="compact" hover>
                    <thead>
                        <tr>
                            <th>Карточка</th>
                            <th>Причина</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="a in store.report.ambiguous" :key="a.offer">
                            <td>{{ a.offer }}</td>
                            <td>{{ a.reason }}</td>
                        </tr>
                    </tbody>
                </v-table>
            </v-card>

            <v-expansion-panels class="mt-4" v-if="store.report.notFoundOnOzon.length">
                <v-expansion-panel :title="`Нет карточки на маркетплейсе: ${store.report.notFoundOnOzon.length}`">
                    <v-expansion-panel-text>{{ store.report.notFoundOnOzon.join(', ') }}</v-expansion-panel-text>
                </v-expansion-panel>
            </v-expansion-panels>
        </template>
    </v-container>
</template>

<style scoped>

</style>
