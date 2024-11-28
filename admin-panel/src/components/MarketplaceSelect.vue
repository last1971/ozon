<script setup lang="ts">
    import { GoodServiceEnum } from "@/stores/goods";
    import { ref, watch } from "vue";

    const marketplaces = Object.values(GoodServiceEnum).map((service) => ({
        title: service.toUpperCase(), // Текст в верхнем регистре
        data: service,             // Исходное значение из Enum
    }));

    const props = defineProps<{
        modelValue: GoodServiceEnum;
    }>();

    const emit = defineEmits<{
        (e: "update:modelValue", value: GoodServiceEnum): void;
    }>();

    const internalValue = ref<GoodServiceEnum>(props.modelValue);

    watch(internalValue, (newValue) => {
        emit("update:modelValue", newValue);
    });
</script>

<template>

        <v-select
            :items="marketplaces"
            v-model="internalValue"
            label="Маркетплейсы"
            item-title="title"
            item-value="data"
            density="compact"
        />

</template>

<style scoped>

</style>