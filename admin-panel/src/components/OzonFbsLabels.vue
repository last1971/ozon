<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { ItemFbsDto } from "@/contracts/item.fbs.dto";
import { labelStore } from "@/stores/labels";
import { postingStore } from "@/stores/postings";
import type { SizeDto } from "@/contracts/size.dto";
import ProductImage from "@/components/ProductImage.vue";
import BarcodeImage from "@/components/BarcodeImage.vue";
import MarketplaceSelect from "@/components/MarketplaceSelect.vue";
import { GoodServiceEnum } from "@/stores/goods";

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
const printNumber = ref(false);

const barcodeType = ref('code128');

const labelTypes: SizeDto[] = [
    {
        name: '43 x 25',
        width: 43,
        height: 25,
    },
    {
        name: '58 x 40',
        width: 58,
        height: 40,
    },
];

const labelType = ref(labelTypes[1]);

// const items = ref<ItemFbsDto[]>([]);

const selectedRows = ref<string[]>([]);

const getRowProps = (row: { item: ItemFbsDto }) => {
    return {
        class: {
            'selected-row': selectedRows.value.includes(row.item.id),
        },
    };
};

const service = ref<GoodServiceEnum>(GoodServiceEnum.OZON);

const updateData = async () => {
    posting.clearAwaitingDelivery();
    selectedRows.value = [];
    await store.fetchAndCombineData(service.value);
};

const getLabels = async () => {
    await store.getLabels(selectedRows.value, barcodeType.value, labelType.value, printNumber.value);
};

// Асинхронная загрузка данных при инициализации
onMounted(async () => {
    await store.fetchAndCombineData(service.value);
});

watch(service, async () => {
    await updateData();
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
                <v-btn @click="updateData" :loading="store.isLoading" class="w-25 pa-2 mr-2">
                    Обновить данные
                </v-btn>

                <!-- Кнопка для pdf -->
                <v-btn @click="getLabels"
                       :loading="store.isLoading"
                       class="w-20 pa-2 mr-2"
                       :disabled="!selectedRows.length"
                >
                    Печать этикеток
                </v-btn>
                <div class="w-25 mr-2">
                    <v-combobox
                        label="Тип"
                        :items="['code39', 'code128', 'qrcode', 'text']"
                        v-model="barcodeType"
                        density="compact"
                    ></v-combobox>
                </div>
                <div class="w-25 mr-2">
                    <v-combobox
                        label="Размер"
                        :items="labelTypes"
                        item-title="name"
                        v-model="labelType"
                        density="compact"
                    ></v-combobox>
                </div>
                <div class="w-25 mr-2 mb-4">
                    <v-switch
                        v-model="printNumber"
                        density="compact"
                        label="Номер заказа"
                        hide-details
                        inset
                    ></v-switch>
                </div>
                <div class="w-25">
                    <marketplace-select v-model="service" />
                </div>
            </div>
        </template>
        <!-- Слот для отображения изображения товара -->
        <template #item.image="{ item }">
            <product-image :image="item.image" :alt="item.name" />
        </template>

        <!-- Слот для отображения изображения штрихкода -->
        <template #item.barcode="{ item }">
           <barcode-image :barcode-type="barcodeType" :url="url" :barcode="item.barcode" />
        </template>
    </v-data-table>
</template>

<style>
.selected-row {
    background-color: #f0f8ff !important; /* Цвет фона для выделенных строк */
}
</style>