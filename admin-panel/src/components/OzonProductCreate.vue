<script setup lang="ts">
import { ozonProductStore } from "@/stores/ozonProduct";
import { computed, ref, onMounted, watch } from "vue";
import axios from "../axios.config";

const store = ozonProductStore();

const formDisabled = computed(() => !!store.createResult && !store.createResult.error);
const showCheck = computed(() => store.createResult?.task_id && !store.importInfo);
const showClear = computed(() => !!store.importInfo || !!store.createResult?.error);

// AI providers & models
const aiProviders = ref<{ name: string; models: { id: string; name: string }[] }[]>([]);
const providerItems = computed(() => aiProviders.value.map(p => p.name));
const modelItems = computed(() => {
    const prov = aiProviders.value.find(p => p.name === store.form.provider);
    return prov ? prov.models.map(m => ({ title: m.name || m.id, value: m.id })) : [];
});

watch(() => store.form.provider, () => { store.form.model = ''; });

onMounted(async () => {
    store.initWatcher();
    try {
        const res = await axios.get("/api/ozon-category/ai-providers");
        aiProviders.value = res.data;
    } catch {}
});

// Images
function addImage() { store.form.images.push(''); }
function removeImage(i: string | number) { store.form.images.splice(Number(i), 1); }

// PDF
function addPdf() { store.form.pdf_list.push({ index: store.form.pdf_list.length, name: '', src_url: '' }); }
function removePdf(i: string | number) { store.form.pdf_list.splice(Number(i), 1); }

// Quantities
function addQty() { store.form.quantities.push(null); }
function removeQty(i: string | number) { store.form.quantities.splice(Number(i), 1); }

// Packages
function addPkg() { store.form.packages.push(null); }
function removePkg(i: string | number) { store.form.packages.splice(Number(i), 1); }
</script>

<template>
    <v-container fluid class="pa-0">
        <!-- Error -->
        <v-alert v-if="store.errorMessage" type="error" closable class="mb-4" @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>

        <!-- Form -->
        <v-form :readonly="formDisabled">
            <v-row dense>
                <v-col cols="12">
                    <v-textarea v-model="store.form.text" label="Текст товара *" rows="3" auto-grow />
                </v-col>
            </v-row>

            <v-row dense>
                <v-col cols="4">
                    <v-text-field v-model="store.form.offer_id" label="Артикул (offer_id) *" />
                </v-col>
                <v-col cols="4">
                    <v-text-field v-model="store.form.category_path" label="Путь категории" placeholder="Электроника > Компоненты > ..." />
                </v-col>
            </v-row>

            <v-row dense>
                <v-col cols="2">
                    <v-text-field v-model.number="store.form.package_depth" label="Глубина, мм" type="number" />
                </v-col>
                <v-col cols="2">
                    <v-text-field v-model.number="store.form.package_width" label="Ширина, мм" type="number" />
                </v-col>
                <v-col cols="2">
                    <v-text-field v-model.number="store.form.package_height" label="Высота, мм" type="number" />
                </v-col>
                <v-col cols="2">
                    <v-text-field v-model.number="store.form.weight_with_packaging" label="Вес с уп., г" type="number" />
                </v-col>
                <v-col cols="2">
                    <v-text-field v-model.number="store.form.weight_without_packaging" label="Вес без уп., г" type="number" />
                </v-col>
            </v-row>

            <!-- Images -->
            <v-row dense align="center">
                <v-col cols="12">
                    <div class="text-subtitle-2 mb-1">Картинки *</div>
                </v-col>
            </v-row>
            <v-row dense v-for="(img, i) in store.form.images" :key="'img-'+i" align="center">
                <v-col cols="8">
                    <v-text-field v-model="store.form.images[i]" :label="'URL картинки ' + (Number(i)+1)" density="compact" />
                </v-col>
                <v-col cols="1">
                    <v-btn icon size="small" variant="text" color="red" @click="removeImage(i)" :disabled="store.form.images.length <= 1">
                        <v-icon>mdi-minus-circle</v-icon>
                    </v-btn>
                </v-col>
            </v-row>
            <v-row dense>
                <v-col><v-btn size="small" variant="text" @click="addImage">+ Картинка</v-btn></v-col>
            </v-row>

            <!-- PDF -->
            <v-row dense align="center" class="mt-2">
                <v-col cols="12">
                    <div class="text-subtitle-2 mb-1">PDF файлы</div>
                </v-col>
            </v-row>
            <v-row dense v-for="(pdf, i) in store.form.pdf_list" :key="'pdf-'+i" align="center">
                <v-col cols="1">
                    <v-text-field v-model.number="store.form.pdf_list[i].index" label="Index" type="number" density="compact" />
                </v-col>
                <v-col cols="3">
                    <v-text-field v-model="store.form.pdf_list[i].name" label="Название" density="compact" />
                </v-col>
                <v-col cols="4">
                    <v-text-field v-model="store.form.pdf_list[i].src_url" label="URL" density="compact" />
                </v-col>
                <v-col cols="1">
                    <v-btn icon size="small" variant="text" color="red" @click="removePdf(i)">
                        <v-icon>mdi-minus-circle</v-icon>
                    </v-btn>
                </v-col>
            </v-row>
            <v-row dense>
                <v-col><v-btn size="small" variant="text" @click="addPdf">+ PDF</v-btn></v-col>
            </v-row>

            <!-- Quantities -->
            <v-row dense align="center" class="mt-2">
                <v-col cols="12">
                    <div class="text-subtitle-2 mb-1">Варианты количества</div>
                </v-col>
            </v-row>
            <v-row dense>
                <v-col cols="auto" v-for="(q, i) in store.form.quantities" :key="'qty-'+i" class="d-flex align-center">
                    <v-text-field v-model.number="store.form.quantities[i]" type="number" density="compact" style="width:100px" hide-details />
                    <v-btn icon size="x-small" variant="text" color="red" @click="removeQty(i)" class="ml-1">
                        <v-icon>mdi-minus-circle</v-icon>
                    </v-btn>
                </v-col>
                <v-col cols="auto">
                    <v-btn size="small" variant="text" @click="addQty">+ Кол-во</v-btn>
                </v-col>
            </v-row>

            <!-- Packages -->
            <v-row dense align="center" class="mt-2">
                <v-col cols="12">
                    <div class="text-subtitle-2 mb-1">Упаковки (число или d,w,h)</div>
                </v-col>
            </v-row>
            <v-row dense>
                <v-col cols="auto" v-for="(p, i) in store.form.packages" :key="'pkg-'+i" class="d-flex align-center">
                    <v-text-field v-model="store.form.packages[i]" density="compact" style="width:140px" hide-details placeholder="1 или 100,80,50" />
                    <v-btn icon size="x-small" variant="text" color="red" @click="removePkg(i)" class="ml-1">
                        <v-icon>mdi-minus-circle</v-icon>
                    </v-btn>
                </v-col>
                <v-col cols="auto">
                    <v-btn size="small" variant="text" @click="addPkg">+ Упаковка</v-btn>
                </v-col>
            </v-row>

            <!-- Optional -->
            <v-row dense class="mt-2">
                <v-col cols="2">
                    <v-checkbox v-model="store.form.all_attributes" label="Все атрибуты" hide-details />
                </v-col>
                <v-col cols="3">
                    <v-select v-model="store.form.provider" label="AI провайдер" :items="providerItems" clearable density="compact" />
                </v-col>
                <v-col cols="3">
                    <v-select v-model="store.form.model" label="Модель AI" :items="modelItems" clearable density="compact" :disabled="!store.form.provider" />
                </v-col>
            </v-row>
        </v-form>

        <!-- Actions -->
        <v-row dense class="mt-4">
            <v-col cols="auto">
                <v-btn
                    v-if="!formDisabled"
                    color="primary"
                    :loading="store.isCreating"
                    @click="store.createProduct()"
                >
                    Создать
                </v-btn>
                <v-btn
                    v-if="showCheck"
                    color="info"
                    :loading="store.isChecking"
                    @click="store.checkImport()"
                >
                    Проверить (task_id: {{ store.createResult?.task_id }})
                </v-btn>
                <v-btn
                    v-if="showClear"
                    color="warning"
                    @click="store.clearAll()"
                >
                    Очистить
                </v-btn>
            </v-col>
        </v-row>

        <!-- Create result -->
        <v-card v-if="store.createResult && !store.createResult.error" class="mt-4" variant="outlined">
            <v-card-title class="text-subtitle-1">Результат создания</v-card-title>
            <v-card-text>
                <div><strong>Task ID:</strong> {{ store.createResult.task_id }}</div>
                <div><strong>Название:</strong> {{ store.createResult.generated_name }}</div>
                <div><strong>Категория:</strong> {{ store.createResult.category_path }}</div>
                <div><strong>Комиссия FBS:</strong> {{ store.createResult.fbs_commission }}</div>
                <div v-if="store.createResult.costs">
                    <strong>Стоимость AI:</strong>
                    Название: ${{ store.createResult.costs.name?.cost?.toFixed(6) || '0' }},
                    Атрибуты: ${{ store.createResult.costs.attributes?.cost?.toFixed(6) || '0' }}
                </div>
                <v-expansion-panels class="mt-2">
                    <v-expansion-panel title="product_json">
                        <v-expansion-panel-text>
                            <pre style="font-size:12px; max-height:400px; overflow:auto">{{ JSON.stringify(store.createResult.product_json, null, 2) }}</pre>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>
            </v-card-text>
        </v-card>

        <!-- Import info -->
        <v-card v-if="store.importInfo" class="mt-4" variant="outlined">
            <v-card-title class="text-subtitle-1">Статус импорта</v-card-title>
            <v-card-text>
                <v-table dense v-if="store.importInfo.result?.items?.length">
                    <thead>
                        <tr>
                            <th>offer_id</th>
                            <th>product_id</th>
                            <th>status</th>
                            <th>ошибки</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in store.importInfo.result.items" :key="item.offer_id">
                            <td>{{ item.offer_id }}</td>
                            <td>{{ item.product_id }}</td>
                            <td>{{ item.status }}</td>
                            <td>
                                <div v-for="(err, ei) in item.errors" :key="ei" class="text-red">{{ err.code }}: {{ err.message }}</div>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
                <div v-else>Нет данных</div>
            </v-card-text>
        </v-card>
    </v-container>
</template>
