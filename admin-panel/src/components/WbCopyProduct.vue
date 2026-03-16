<script setup lang="ts">
import { wbCopyProductStore } from "@/stores/wbCopyProduct";
import { onMounted } from "vue";

const store = wbCopyProductStore();

const categoryModes = [
    { title: 'По типу Ozon', value: 'byOzonType' },
    { title: 'По названию', value: 'byName' },
    { title: 'Вручную (subjectId)', value: 'manual' },
];

onMounted(() => {
    store.initWatcher();
});
</script>

<template>
    <v-container fluid class="pa-0">
        <!-- Error -->
        <v-alert v-if="store.errorMessage" type="error" closable class="mb-4" @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>

        <!-- Form -->
        <v-form>
            <v-row dense>
                <v-col cols="3">
                    <v-text-field v-model="store.form.offerId" label="Артикул Ozon (offer_id) *" />
                </v-col>
                <v-col cols="3">
                    <v-select v-model="store.form.categoryMode" label="Выбор категории WB" :items="categoryModes" />
                </v-col>
                <v-col cols="2" v-if="store.form.categoryMode === 'manual'">
                    <v-text-field v-model.number="store.form.subjectId" label="WB subjectId" type="number" />
                </v-col>
                <v-col cols="2">
                    <v-checkbox v-model="store.form.webSearch" label="Web search (AI)" hide-details />
                </v-col>
            </v-row>

            <v-row dense>
                <v-col cols="6">
                    <v-text-field
                        v-model="store.form.title"
                        label="Название WB (если пусто — сгенерирует AI)"
                        :counter="60"
                        :rules="[v => !v || v.length <= 60 || 'Макс 60 символов']"
                        hint="Оставьте пустым для автогенерации"
                        persistent-hint
                    />
                </v-col>
            </v-row>

            <v-row dense class="mt-2">
                <v-col cols="auto">
                    <v-btn
                        color="primary"
                        :loading="store.isCreating"
                        :disabled="store.isCreating"
                        @click="store.createCard()"
                    >
                        Копировать в WB
                    </v-btn>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        color="warning"
                        @click="store.clearAll()"
                    >
                        Очистить
                    </v-btn>
                </v-col>
            </v-row>
        </v-form>

        <!-- Create result -->
        <v-card v-if="store.createResult && !store.createResult.error" class="mt-4" variant="outlined">
            <v-card-title class="text-subtitle-1">Результат создания</v-card-title>
            <v-card-text>
                <div><strong>Название:</strong> {{ store.createResult.title }}</div>
                <div><strong>Бренд:</strong> {{ store.createResult.brand }}</div>
                <div v-if="store.createResult.aiCost"><strong>Стоимость AI:</strong> ${{ store.createResult.aiCost?.toFixed(6) }}</div>
                <v-expansion-panels class="mt-2">
                    <v-expansion-panel title="uploadBody">
                        <v-expansion-panel-text>
                            <pre style="font-size:12px; max-height:400px; overflow:auto">{{ JSON.stringify(store.createResult.uploadBody, null, 2) }}</pre>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="store.createResult.uploadResult" title="uploadResult (ответ WB)">
                        <v-expansion-panel-text>
                            <pre style="font-size:12px; max-height:400px; overflow:auto">{{ JSON.stringify(store.createResult.uploadResult, null, 2) }}</pre>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="store.createResult.characteristics" title="characteristics">
                        <v-expansion-panel-text>
                            <pre style="font-size:12px; max-height:400px; overflow:auto">{{ JSON.stringify(store.createResult.characteristics, null, 2) }}</pre>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>
            </v-card-text>
        </v-card>

        <!-- Upload media -->
        <v-card class="mt-4" variant="outlined">
            <v-card-title class="text-subtitle-1">Загрузка фото в WB</v-card-title>
            <v-card-text>
                <v-row dense>
                    <v-col cols="3">
                        <v-text-field v-model.number="store.form.nmId" label="nmId карточки WB *" type="number" />
                    </v-col>
                    <v-col cols="auto" class="d-flex align-center">
                        <v-btn
                            color="secondary"
                            :loading="store.isUploading"
                            :disabled="store.isUploading"
                            @click="store.uploadMedia()"
                        >
                            Загрузить фото
                        </v-btn>
                    </v-col>
                </v-row>
                <v-alert v-if="store.uploadResult && !store.uploadResult.error" type="success" class="mt-2" density="compact">
                    Загружено {{ store.uploadResult.imagesCount }} фото
                </v-alert>
            </v-card-text>
        </v-card>
    </v-container>
</template>
