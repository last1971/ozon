<script setup lang="ts">
import { ref } from "vue";
import SelectWbSupply from "@/components/SelectWbSupply.vue";
import { type SupplyOrderDto, useSupplyStore } from "@/stores/supply";
import { storeToRefs } from "pinia";

// Константы
const SUCCESS_SOUND_URL = "https://www.soundjay.com/buttons/sounds/button-17.mp3";
const ERROR_SOUND_URL = "https://www.soundjay.com/buttons/sounds/button-10.mp3";
const ERROR_MESSAGE = "Значение не найдено!";
const SUCCESS_STYLE = { backgroundColor: "#4caf50", color: "white" }; // Стиль успешного элемента


const searchQuery = ref(""); // Значение текстового поля
const selectedItems = ref<SupplyOrderDto[]>([]); // Список выбранных элементов
// Реактивное свойство для хранения выбранного значения из `select-wb-supply`
const selectedSupply = ref<string>('');

const errorMessage = ref(''); // Сообщение об ошибке

const supplyStore = useSupplyStore();

const { supplyOrders } = storeToRefs(supplyStore);

// Функция для воспроизведения звука
const playSound = (url: string) => new Audio(url).play();

// Добавление выбранного элемента
const addSelectedItem = (item: SupplyOrderDto) => {
    // Проверка: если элемент уже выбран, играем сигнал ошибки
    if (selectedItems.value.includes(item)) {
        playSound(ERROR_SOUND_URL);
    } else {
        selectedItems.value.push(item);
        playSound(SUCCESS_SOUND_URL); // Сигнал успеха
    }
};

// Функция обработки ввода
const onSearch = () => {
    if (searchQuery.value[0] === ';') {
        // Если ошибка раскладки, показываем сообщение, но очищаем поле
        errorMessage.value = 'Переключите раскладку на ангельский';
        searchQuery.value = '';
        return; // Не отправляем запрос на обработку
    }
    errorMessage.value = '';
    const foundItem = supplyOrders.value.find((item) => item.barCode === searchQuery.value); // Поиск элемента
    if (foundItem) {
        addSelectedItem(foundItem); // Попытка добавить элемент
    } else {
        playSound(ERROR_SOUND_URL); // Проиграть звук ошибки для несуществующего элемента
    }
    searchQuery.value = ''; // Очистить поле ввода
};

async function onSupplyChange(newValue: string | null) {
    if (newValue) await supplyStore.fetchSupplyOrders(newValue);
}
</script>

<template>
    <v-container>
        <v-row>
            <v-col cols="4">
                <!-- Поле ввода -->
                <v-text-field
                    v-model="searchQuery"
                    label="Отсканируйте заказ"
                    @keyup.enter="onSearch"
                    :error="!!errorMessage"
                    :error-messages="errorMessage"
                    outlined
                ></v-text-field>
            </v-col>
            <v-col cols="4">
                <select-wb-supply
                    v-model="selectedSupply"
                    @update:modelValue="onSupplyChange"
                />
            </v-col>
            <v-col cols="4" class="d-flex align-center">
                <span class="text-body-2">Выбрано: </span>
                <span class="text-h5 font-weight-bold mx-1">{{ selectedItems.length }}</span>
                <span class="text-body-2">из</span>
                <span class="text-h5 font-weight-bold mx-1">{{ supplyOrders.length }}</span>
            </v-col>
        </v-row>
        <v-container>
            <!-- Список элементов -->
            <v-row dense class="gap-4">
                <v-col cols="3" v-for="(order, index) in supplyOrders" :key="order.id">
                    <!-- Карточка -->
                    <v-card
                        class="pa-3"
                        :style="{ ...(selectedItems.includes(order) ? SUCCESS_STYLE : {}) }"
                    >
                        <v-card-text>{{ order.remark }}</v-card-text>
                    </v-card>
                </v-col>
            </v-row>
        </v-container>
    </v-container>
</template>

<style scoped>

</style>