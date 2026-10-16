<script setup lang="ts">
import { saveUser } from "@/stores/username";

/**
 * «Кто оформляет» для документов (приём возвратов, пересортица): одно поле на все экраны.
 * Имя хранит сам — запомненное отдаёт хранилище экрана через readUser при старте.
 */
defineProps<{ modelValue: string; label?: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

function update(value: string) {
    saveUser(value);
    emit("update:modelValue", value);
}
</script>

<template>
    <v-text-field
        :model-value="modelValue"
        :label="label ?? 'Кто оформляет'"
        density="compact"
        hide-details
        :error="!modelValue.trim()"
        @update:model-value="update"
    />
</template>
