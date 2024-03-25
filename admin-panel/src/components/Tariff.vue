<script setup lang="ts">

import { tariffStore } from "@/stores/tariffStore";
import { onMounted } from "vue";

const tariff = tariffStore();
onMounted(async () => {
    await reloadTrarif();
});

async function reloadTrarif() {
    await tariff.get();
}

</script>

<template>
    <v-table hover>
        <template v-slot:top>
            <v-btn prepend-icon="mdi-reload" @click="reloadTrarif">
                Обновить
            </v-btn>
        </template>
        <thead>
        <tr>
            <th class="text-left">
                Нац Макс
            </th>
            <th class="text-left">
                Нац Норм
            </th>
            <th class="text-left">
                Нац Мин
            </th>
            <th class="text-left">
                Эквайр
            </th>
            <th class="text-left">
                Миля
            </th>
            <th class="text-left">
                Мин Миля
            </th>
            <th class="text-left">
                Обработка
            </th>
            <th class="text-left">
                Упаковка
            </th>
            <th class="text-left">
                Этикетка
            </th>
        </tr>
        </thead>
        <tbody>
        <tr>
            <td>{{ tariff.tariffs.perc_max }} %</td>
            <td>{{ tariff.tariffs.perc_nor }} %</td>
            <td>{{ tariff.tariffs.perc_min }} %</td>
            <td>{{ tariff.tariffs.perc_ekv }} %</td>
            <td>{{ tariff.tariffs.perc_mil }} %</td>
            <td>{{ tariff.tariffs.min_mil }} ₽</td>
            <td>{{ tariff.tariffs.sum_obtain }} ₽</td>
            <td>{{ tariff.tariffs.sum_pack }} ₽</td>
            <td>{{ tariff.tariffs.sum_label }} ₽</td>
        </tr>
        </tbody>
    </v-table>
</template>

<style scoped>

</style>