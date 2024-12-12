<script setup lang="ts">

import { tariffStore } from "@/stores/tariffStore";
import { onMounted } from "vue";
import { storeToRefs } from "pinia";

const tariff = tariffStore();
onMounted(async () => {
    await reloadTrarif();
});
const { isLoading } = storeToRefs(tariffStore())
async function reloadTrarif() {
    await tariff.get();
}

</script>

<template>
    <v-table hover>
        <template v-slot:top>
            <v-btn
                prepend-icon="mdi-reload"
                @click="reloadTrarif"
                :disabled="isLoading"
                :loading="isLoading"
            >
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
            <th style="text-align: center; vertical-align: middle;">
                <v-icon>mdi-trending-down</v-icon>
            </th>
            <th style="text-align: center; vertical-align: middle;">
                <v-icon>mdi-percent</v-icon>
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
            <td>
                <v-text-field v-model="tariff.tariffs.min_price"
                              label="Мин.цена"
                              append-inner
                >
                    <template #append-inner>
                        <v-icon>mdi-currency-rub</v-icon>
                    </template>
                </v-text-field>
            </td>
            <td><v-text-field v-model="tariff.tariffs.min_perc" label="Мин.нац."></v-text-field></td>
        </tr>
        </tbody>
    </v-table>
</template>

<style scoped>

</style>