<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useSupplyStore, type SupplyDto } from "@/stores/supply";
import { storeToRefs } from "pinia";

// Объявление prop для v-model
defineProps({
    modelValue: {
        type: Object || null, // Указать тип данных, например String
        required: false,
        default: null,
    },
});

// Генерация события для изменения значения
const emit = defineEmits(['update:modelValue']);

// Инициализация стора
const supplyStore = useSupplyStore();

// Локальная переменная для выбранного значения в селекте
const selectedSupply = ref<SupplyDto | null>(null);

// Данные из стора
const { wbSupplies, isLoading, error } = storeToRefs(useSupplyStore());

// Вызов fetchSupplies при инициализации компонента
onMounted(async () => {
    await supplyStore.fetchSupplies();
});

// Следим за локальным изменением и отправляем событие
watch(selectedSupply, (newValue) => {
    emit('update:modelValue', newValue);
});
</script>

<template>

        <v-select
            v-model="selectedSupply"
            :items="wbSupplies"
            item-title="remark"
            label="Выберите поставку"
            :return-object="true"
            :loading="isLoading"
            :disabled="isLoading"
        ></v-select>
        <div v-if="error" class="error-message">{{ error }}</div>

</template>

<style scoped>
.error-message {
    color: red;
    margin-top: 10px;
}
</style>