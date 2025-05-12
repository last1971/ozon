<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import SelectWbSupply from '@/components/SelectWbSupply.vue';
import { type SupplyOrderDto, type SupplyDto, useSupplyStore } from '@/stores/supply';
import { storeToRefs } from 'pinia';

// Константы
const SUCCESS_SOUND_URL = 'https://www.soundjay.com/buttons/sounds/button-17.mp3';
const ERROR_SOUND_URL = 'https://www.soundjay.com/buttons/sounds/button-10.mp3';
const ERROR_MESSAGE = 'Значение не найдено!';
const SUCCESS_STYLE = { backgroundColor: '#4caf50', color: 'white' }; // Стиль успешного элемента

const cardsContainer = ref<(HTMLElement | null)>(null);
const maxCardHeight = ref(0);

const updateMaxHeight = async () => {
     await nextTick();
     console.log('updateMaxHeight');
     if (!cardsContainer.value) return;
     const cardNodes = cardsContainer.value.querySelectorAll('.card-height');
     if (!cardNodes.length) {
        maxCardHeight.value = 0;
        return;
     }
     maxCardHeight.value = Math.max(
       ...Array.from(cardNodes).map((el: any) => el.offsetHeight || 0)
     );
     // Применяем высоту всем карточкам
     cardNodes.forEach((el: any) => {
        el.style.height = maxCardHeight.value + 'px';
     });
};

const searchQuery = ref(''); // Значение текстового поля
const selectedItems = ref<SupplyOrderDto[]>([]); // Список выбранных элементов
// Реактивное свойство для хранения выбранного значения из `select-wb-supply`
const selectedSupply = ref<SupplyDto | null>(null);

// Добавляем Map для отслеживания количества выбранных элементов по баркоду
const selectedItemsCount = ref(new Map<string, number>());

const errorMessage = ref(''); // Сообщение об ошибке

const supplyStore = useSupplyStore();

const { supplyOrders } = storeToRefs(supplyStore);

// Функция для воспроизведения звука
const playSound = (url: string) => new Audio(url).play();

// Добавление выбранного элемента
const addSelectedItem = (item: SupplyOrderDto) => {
    const currentCount = selectedItemsCount.value.get(item.barCode) || 0;
    if (currentCount >= item.quantity) {
        playSound(ERROR_SOUND_URL);
        errorMessage.value = 'Достигнуто максимальное количество';
    } else {
        selectedItems.value.push(item);
        selectedItemsCount.value.set(item.barCode, currentCount + 1);
        playSound(SUCCESS_SOUND_URL);
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

onMounted(updateMaxHeight);
watch(() => selectedSupply.value?.isMarketplace, updateMaxHeight);

async function onSupplyChange(newValue: SupplyDto | null) {
    if (newValue) {
        await supplyStore.fetchSupplyOrders(newValue.id);
        selectedSupply.value = newValue;
        selectedItems.value = [];
        selectedItemsCount.value.clear();
    }
}

const totalQuantity = computed(() => {
    return supplyOrders.value.reduce((sum, order) => {
        // Для не маркетплейса берем quantity, для маркетплейса считаем как 1
        return sum + (selectedSupply.value?.isMarketplace ? 1 : order.quantity || 0);
    }, 0);
});
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
                <select-wb-supply @update:modelValue="onSupplyChange" />
            </v-col>
            <v-col cols="4" class="d-flex align-center">
                <span class="text-body-2">Выбрано: </span>
                <span class="text-h5 font-weight-bold mx-1">{{ selectedItems.length }}</span>
                <span class="text-body-2">из</span>
                <span class="text-h5 font-weight-bold mx-1">{{ totalQuantity }}</span>
            </v-col>
        </v-row>
        <v-container>
            <!-- Список элементов -->
            <div ref="cardsContainer">
            <v-row dense class="gap-4">
                <v-col 
                    cols="3" 
                    v-for="(order, idx) in supplyOrders" 
                    :key="order.remark"
                    :style="{ height: maxCardHeight + 'px', marginBottom: '8px' }"
                >
                    <!-- Карточка -->
                    <v-card
                        class="card-height"
                        :style="{                        
                            ...((selectedItemsCount.get(order.barCode) || 0) === order.quantity ? 
                            { backgroundColor: '#4CAF50', color: 'white' } : {}),
                        }"
                    >
                        <v-card-text class="d-flex flex-column" style="height: 100%;">                    
                            <div>
                                {{ order.remark }}
                            </div>
                            <v-spacer />
                            <v-chip
                                v-if="selectedSupply?.isMarketplace === false"
                                label
                                color="primary"
                                class="ml-2"
                            >
                                Выбрано: {{ selectedItemsCount.get(order.barCode) || 0 }} из {{ order.quantity }}
                            </v-chip>
                        </v-card-text>
                    </v-card>
                </v-col>
            </v-row>
            </div>
        </v-container>
    </v-container>
</template>

<style scoped></style>
