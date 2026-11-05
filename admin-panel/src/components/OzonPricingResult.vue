<script setup lang="ts">
import type { OzonPricingResultDto } from '@/contracts/ozon-pricing-result.dto';

defineProps<{ result?: OzonPricingResultDto; loading?: boolean }>();
const levels = [
    { key: 'min', label: 'Мин' },
    { key: 'normal', label: 'Норм' },
    { key: 'max', label: 'Макс' },
] as const;
const sources = {
    market: 'Рыночная',
    'remaining-lots': 'Остаточные партии',
    'all-receipts': 'Все приходы',
    none: 'Нет базы',
};
const money = (value: number | null | undefined) =>
    value == null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const percent = (value: number) => (value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '%';
const costLabels = {
    commission: 'Комиссия',
    delivery: 'Доставка',
    lastMile: 'Последняя миля',
    firstMile: 'Первая миля',
    acquiring: 'Эквайринг',
    advertising: 'Реклама',
    packing: 'Упаковка',
    label: 'Этикетка',
    handling: 'Обработка',
    returns: 'Возвраты',
    tax: 'Налог УСН',
    vat: 'НДС',
    profitTax: 'Налог на прибыль',
};
</script>

<template>
    <section class="my-4" :aria-busy="Boolean(loading)">
        <h3 class="text-subtitle-1 mb-2">Расчётная цена Ozon (формула этапа 6)</h3>
        <p v-if="loading" class="text-grey" role="status">{{ result ? 'Обновление…' : 'Расчёт…' }}</p>
        <p v-if="result?.error" class="text-grey" role="status">{{ result.error }}</p>
        <template v-else-if="result">
            <p class="mb-2">База себестоимости: {{ sources[result.baseSource] }} — {{ money(result.base) }}</p>
            <v-table>
                <thead>
                    <tr>
                        <th>Уровень</th>
                        <th>Текущая Ozon</th>
                        <th>Расчётная</th>
                        <th>Прибыль</th>
                        <th>Схема</th>
                        <th>Комиссия</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="level in levels" :key="level.key">
                        <td>{{ level.label }}</td>
                        <td>{{ money(result.current?.[level.key]) }}</td>
                        <td>{{ money(result[level.key]?.price) }}</td>
                        <td>{{ money(result[level.key]?.profit) }}</td>
                        <td>{{ result[level.key]?.scheme.toUpperCase() ?? '—' }}</td>
                        <td>{{ result[level.key] ? percent(result[level.key]!.commissionRate) : '—' }}</td>
                    </tr>
                </tbody>
            </v-table>
            <p v-if="result.deadZoneFloor !== undefined" class="text-warning my-2" role="status">
                ⚠ Мёртвая зона: цена покупателю должна быть ≤ 300 ₽ или ≥ {{ money(result.deadZoneFloor) }}
            </p>
            <details v-if="result.costs" class="mt-2">
                <summary>Расходы при минимальной цене</summary>
                <v-row class="mt-1">
                    <v-col v-for="(label, key) in costLabels" :key="key" cols="12" sm="6" md="4">
                        {{ label }}: {{ money(result.costs[key]) }}
                    </v-col>
                </v-row>
            </details>
        </template>
        <p v-else-if="!loading" class="text-grey">Расчёт ещё не загружен</p>
    </section>
</template>
