
<template>
    <v-snackbar
        v-model="snackbarState.visible"
        :timeout="timeout"
        :color="color"
        location="top right"
        variant="elevated"
        :multi-line="isMultiLine"
        :vertical="isMultiLine"
        max-width="500px"
    >
        <div class="d-flex align-center">
            <v-icon :icon="icon" class="me-2" />
            <div class="flex-grow-1">
                <div class="text-subtitle2 font-weight-medium">{{ snackbarState.title }}</div>
                <div v-if="snackbarState.message" class="text-body-2 mt-1">{{ snackbarState.message }}</div>

                <!-- Список результатов сервисов -->
                <div v-if="snackbarState.serviceResults && snackbarState.serviceResults.length > 0" class="mt-2">
                    <v-tooltip
                        v-for="result in snackbarState.serviceResults"
                        :key="result.service"
                        :text="getTooltipText(result)"
                        location="bottom"
                    >
                        <template #activator="{ props }">
                            <v-chip
                                v-bind="props"
                                :color="getServiceChipColor(result)"
                                size="small"
                                variant="outlined"
                                class="me-1 mb-1"
                            >
                                {{ result.service.toUpperCase() }}
                                <v-icon
                                    :icon="getServiceIcon(result)"
                                    size="small"
                                    class="ms-1"
                                />
                            </v-chip>
                        </template>
                    </v-tooltip>
                </div>
            </div>
            <v-btn
                icon="mdi-close"
                variant="text"
                size="small"
                @click="hide"
                class="ms-2"
            />
        </div>
    </v-snackbar>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ServiceResult } from '@/contracts/service.result'
import { useInfoSnackbar } from '@/composable/useInfoSnackbar'

const { snackbarState } = useInfoSnackbar()
const timeout = 5000

const color = computed(() => {
    // Если есть serviceResults, используем нейтральный цвет для фона
    if (snackbarState.serviceResults && snackbarState.serviceResults.length > 0) {
        return 'white'
    }
    switch (snackbarState.type) {
        case 'success': return 'success'
        case 'error': return 'error'
        case 'warning': return 'warning'
        default: return 'info'
    }
})

const icon = computed(() => {
    switch (snackbarState.type) {
        case 'success': return 'mdi-check-circle'
        case 'error': return 'mdi-alert-circle'
        case 'warning': return 'mdi-alert'
        default: return 'mdi-information'
    }
})

const isMultiLine = computed(() => {
    return Boolean(snackbarState.message || (snackbarState.serviceResults && snackbarState.serviceResults.length > 0))
})

const getServiceChipColor = (result: ServiceResult) => {
    if (result.result === null) return 'warning'
    if (result.error) return 'error'
    return 'success'
}

const getServiceIcon = (result: ServiceResult) => {
    if (result.result === null) return 'mdi-alert'
    if (result.error) return 'mdi-close'
    return 'mdi-check'
}

const getTooltipText = (result: ServiceResult): string => {
    if (result.result === null) {
        return `${result.service.toUpperCase()}: Нет товаров для обновления`
    }

    if (result.error) {
        return `${result.service.toUpperCase()}: Ошибка - ${result.error}`
    }

    if (!result.result) {
        return `${result.service.toUpperCase()}: Обновление не удалось`
    }

    let tooltip = `${result.service.toUpperCase()}: Успешно обновлено`

    if (result.updatedCount !== undefined) {
        tooltip += ` (${result.updatedCount} шт.)`
    }

    return tooltip
}

const hide = () => {
    snackbarState.visible = false
}
</script>

<style scoped>
.v-snackbar :deep(.v-snackbar__wrapper) {
    min-width: 300px;
}
</style>