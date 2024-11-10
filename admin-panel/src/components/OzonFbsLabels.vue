<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { ItemFbsDto } from "@/contracts/item.fbs.dto";
import { labelStore } from "@/stores/labels";
import { postingStore } from "@/stores/postings";
// import type { GoodInfoDto } from "@/contracts/good.info.dto";

const store = labelStore();
const posting = postingStore();

const url = import.meta.env.VITE_URL;

const headers = ref([
    { title: '', key: 'data-table-select', sortable: false }, // Чекбокс для выбора
    { title: 'Картинка', key: 'image', sortable: false },     // Колонка с картинкой товара
    { title: 'Штрихкод', key: 'barcode', sortable: false },   // Колонка с картинкой штрихкода
    { title: 'Артикул', key: 'sku' },                         // Артикул
    { title: 'Название', key: 'name' },                       // Название товара
    { title: 'Количество', key: 'quantity' },                       // Название товара
    { title: 'Заказ', key: 'order' }                          // Информация о заказе
]);

const barcodeType = ref('code128');

const items = ref<ItemFbsDto[]>([]);

const selectedRows = ref<string[]>([]);

const getRowProps = (row: { item: ItemFbsDto }) => {
    return {
        class: {
            'selected-row': selectedRows.value.includes(row.item.id),
        },
    };
};

const updateData = async () => {
    posting.clearAwaitingDelivery();
    await store.fetchAndCombineData();
};

const getLabels = async () => {
    await store.getLabels(selectedRows.value, barcodeType.value)
};

// Асинхронная загрузка данных при инициализации
onMounted(async () => {
    await store.fetchAndCombineData();
});

</script>

<template>
    <v-data-table
        :headers="headers"
        :items="store.ozonFbsLabels"
        show-select
        v-model="selectedRows"
        :row-props="getRowProps"
        class="w-100"
    >
        <template v-slot:top>
            <div class="d-flex justify-center justify-space-between">
                <!-- Кнопка для обновления данных -->
                <v-btn @click="updateData" :loading="store.isLoading" class="w-33 pa-2 mr-2">
                    Обновить данные
                </v-btn>

                <!-- Кнопка для pdf -->
                <v-btn @click="getLabels"
                       :loading="store.isLoading"
                       class="w-33 pa-2 mr-2"
                       :disabled="!selectedRows.length"
                >
                    Печать этикеток
                </v-btn>
                <div class="w-33">
                <v-combobox
                    label="Тип"
                    :items="['code39', 'code128']"
                    v-model="barcodeType"
                    density="compact"
                ></v-combobox>
                </div>
            </div>
        </template>
        <!-- Слот для отображения изображения товара -->
        <template #item.image="{ item }">
            <img :src="item.image" alt="Картинка" style="width: 50px; height: 50px;" />
        </template>

        <!-- Слот для отображения изображения штрихкода -->
        <template #item.barcode="{ item }">
            <img :src="`${url}/api/label/generate?bcid=code39&text=${item.barcode}&height=10&width=30`" alt="Штрихкод"
                 style="width: 200px; height: 60px;" />
        </template>
    </v-data-table>
</template>

<style>
.selected-row {
    background-color: #f0f8ff !important; /* Цвет фона для выделенных строк */
}
</style>