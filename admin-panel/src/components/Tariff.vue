<script setup lang="ts">
import { tariffStore } from '@/stores/tariffStore';
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';

const tariff = tariffStore();
onMounted(async () => {
    await reloadTrarif();
});
const { isLoading } = storeToRefs(tariffStore());
async function reloadTrarif() {
    await tariff.get();
}
</script>

<template>
    <p class="text-body-2 mb-2">
        Поля предупреждений меняют только подсветку. Ограничения расчёта показаны у товара и берутся с сервера.
        Эквайринг, приёмка и последняя миля Ozon загружаются из API; резервные значения этой таблицы в расчёте Ozon не
        используются.
    </p>
    <v-table hover>
        <template v-slot:top>
            <v-btn prepend-icon="mdi-reload" @click="reloadTrarif" :disabled="isLoading" :loading="isLoading">
                Обновить
            </v-btn>
        </template>
        <thead>
            <tr>
                <th class="text-left">Наценка по умолчанию: макс</th>
                <th class="text-left">Наценка по умолчанию: норм</th>
                <th class="text-left">Наценка по умолчанию: мин</th>
                <th class="text-left">Эквайринг: резерв</th>
                <th class="text-left">Миля</th>
                <th class="text-left">Мин Миля</th>
                <th class="text-left">Наши внутренние расходы</th>
                <th class="text-left">Упаковка</th>
                <th class="text-left">Этикетка</th>
                <th class="text-left">Налог</th>
                <th style="text-align: center; vertical-align: middle">
                    <v-icon>mdi-trending-down</v-icon>
                </th>
                <th style="text-align: center; vertical-align: middle">
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
                <td>{{ tariff.tariffs.tax_unit }} %</td>
                <td>
                    <v-text-field v-model="tariff.tariffs.min_price" label="Предупреждать ниже, ₽" append-inner>
                        <template #append-inner>
                            <v-icon>mdi-currency-rub</v-icon>
                        </template>
                    </v-text-field>
                </td>
                <td><v-text-field v-model="tariff.tariffs.min_perc" label="Предупреждать ниже, %"></v-text-field></td>
            </tr>
        </tbody>
    </v-table>
</template>

<style scoped></style>
