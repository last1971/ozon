<script setup lang="ts">
import { onMounted, ref } from 'vue';
import axios from '@/axios.config';
const mode = ref<boolean | null>(null);
onMounted(async () => {
    try {
        mode.value = (await axios.get('/api/price/review-mode')).data.reviewMode;
    } catch {
        mode.value = null;
    }
});
</script>
<template>
    <v-alert v-if="mode" type="warning" class="mb-3" role="status">
        Режим проверки цен. Автоматическое и ручное изменение цен и акций отключено. Расчёт и сверка без применения
        доступны. Заказы и остатки продолжают обрабатываться.
    </v-alert>
    <v-alert v-else-if="mode === null" type="info" class="mb-3" role="status">
        Статус режима цен не получен. Проверка разрешения на отправку выполняется сервером.
    </v-alert>
</template>
