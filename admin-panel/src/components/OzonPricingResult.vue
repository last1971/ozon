<script setup lang="ts">
import { lossCostLabels } from '@/contracts/loss-cost-labels';
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
    lastMile: 'Последняя миля Ozon — доставка покупателю',
    firstMile: 'Приёмка FBS Ozon',
    acquiring: 'Эквайринг',
    advertising: 'Реклама',
    packing: 'Упаковка',
    label: 'Этикетка',
    handling: 'Внутренние расходы',
    ...lossCostLabels,
    tax: 'Налог УСН',
    vat: 'НДС',
    profitTax: 'Налог на прибыль',
};
</script>

<template>
    <section class="my-4" :aria-busy="Boolean(loading)">
        <h3 class="text-subtitle-1 mb-2">Текущие и расчётные цены Ozon</h3>
        <p v-if="loading" class="text-grey" role="status">{{ result ? 'Обновление…' : 'Расчёт…' }}</p>
        <p v-if="result?.error" class="text-grey" role="status">{{ result.error }}</p>
        <template v-if="result && (!result.error || $slots.markup)">
            <p class="mb-2">База себестоимости: {{ sources[result.baseSource] }} — {{ money(result.base) }}</p>
            <p v-if="result.limits" class="mb-2">
                Минимум сервера: {{ money(result.limits.minProfitRub) }} прибыли и {{ result.limits.minMarkupPercent }}%
                от базы. Применяется больший порог.
            </p>
            <p v-if="loading" class="text-body-2">Ниже показан предыдущий результат до завершения обновления.</p>
            <v-table>
                <thead>
                    <tr>
                        <th>Уровень</th>
                        <th>Задано</th>
                        <th>Применено</th>
                        <th>Текущая Ozon</th>
                        <th>Расчётная</th>
                        <th>Прибыль, ₽ / % от базы</th>
                        <th>Схема</th>
                        <th>Комиссия</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="level in levels" :key="level.key">
                        <td>{{ level.label }}</td>
                        <td>
                            <slot name="markup" :level="level.key"
                                >{{ result[level.key]?.requestedMarkup ?? '—' }}%</slot
                            >
                        </td>
                        <td>
                            {{
                                result[level.key]?.appliedMarkup?.toLocaleString('ru-RU', {
                                    maximumFractionDigits: 2,
                                }) ?? '—'
                            }}%
                            <small
                                v-if="
                                    result[level.key]?.appliedMarkup !== undefined &&
                                    result[level.key]!.appliedMarkup! > result[level.key]!.requestedMarkup!
                                "
                            >
                                — действует минимум сервера</small
                            >
                        </td>
                        <td>{{ money(result.current?.[level.key]) }}</td>
                        <td>{{ money(result[level.key]?.price) }}</td>
                        <td>
                            {{ money(result[level.key]?.profit) }} /
                            {{
                                result[level.key] && result.base > 0
                                    ? (
                                          result[level.key]!.profitPercent ??
                                          (result[level.key]!.profit / result.base) * 100
                                      ).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
                                    : '—'
                            }}%
                        </td>
                        <td>{{ result[level.key]?.scheme.toUpperCase() ?? '—' }}</td>
                        <td>{{ result[level.key] ? percent(result[level.key]!.commissionRate) : '—' }}</td>
                    </tr>
                </tbody>
            </v-table>
            <p v-if="result.lowerBand" class="my-2" role="status">
                При {{ money(result.lowerBand.ceiling) }} прибыль {{ money(result.lowerBand.profit) }}, требуется
                {{ money(result.lowerBand.targetProfit) }}.
                {{
                    result.lowerBand.eligible
                        ? 'Ступень до 300 ₽ подходит.'
                        : 'Ступень до 300 ₽ не обеспечивает требуемую прибыль или не имеет полного тарифа.'
                }}
                Выбрана минимальная допустимая цена {{ money(result.min?.price) }}.
            </p>
            <p v-if="result.deadZoneFloor !== undefined" class="text-warning my-2" role="status">
                Между 300 ₽ и {{ money(result.deadZoneFloor) }} требуемая минимальная прибыль не обеспечена на верхней
                ступени.
            </p>
            <details v-if="result.costs" class="mt-2">
                <summary>Расходы при минимальной цене</summary>
                <v-row class="mt-1">
                    <v-col v-for="(label, key) in costLabels" :key="key" cols="12" sm="6" md="4">
                        {{ label }}: {{ money(result.costs[key])
                        }}<small class="d-block text-medium-emphasis">{{ result.costSources?.[key] }}</small>
                    </v-col>
                </v-row>
            </details>
        </template>
        <p v-if="!loading && !result" class="text-grey">Расчёт ещё не загружен</p>
    </section>
</template>
