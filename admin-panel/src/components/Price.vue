<script setup lang="ts">
import type { PriceDto } from '@/contracts/price.dto';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { debounce } from 'lodash';
import { priceStore, priceSettingsKey } from '@/stores/prices';
import { tariffStore } from '@/stores/tariffStore';
import PricePromo from './PricePromo.vue';
import OzonPricingResult from './OzonPricingResult.vue';
import PriceSendDialog from './PriceSendDialog.vue';

const props = defineProps<{ value: PriceDto; ind: number }>();
const store = priceStore();
const thresholds = tariffStore();
const error = ref(''),
    message = ref('');
const loading = ref(false);
const result = computed(() => store.ozonPricing[props.value.offer_id]);
const settingsKey = computed(() => priceSettingsKey(props.value));
const dirty = computed(() => settingsKey.value !== store.savedSettings[props.value.offer_id]);
const busy = computed(() => loading.value || store.isLoadingPrice[props.ind]);
const buyer = computed(() => result.value?.buyer);
const warn = computed(
    () =>
        buyer.value &&
        (buyer.value.profit < thresholds.tariffs.min_price || buyer.value.profitPercent < thresholds.tariffs.min_perc),
);
const markupFields = { min: 'min_perc', normal: 'perc', max: 'old_perc' } as const;
const money = (n?: number) => (n == null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽');
async function run(action: () => Promise<void>, success = '') {
    loading.value = true;
    error.value = '';
    message.value = '';
    try {
        await action();
        message.value = success;
    } catch (e: any) {
        error.value = e.response?.data?.message?.toString() || e.message;
    } finally {
        loading.value = false;
    }
}
const recalculate = debounce(() => {
    void store.getInd(props.ind);
}, 2000);
watch(
    () => `${settingsKey.value}|${props.value.incoming_price}`,
    () => {
        message.value = '';
        recalculate();
    },
);
onBeforeUnmount(() => recalculate.cancel());
function calculateNow() {
    recalculate.cancel();
    void run(() => store.getInd(props.ind));
}
</script>
<template>
    <div>
        <v-alert v-if="error" type="error">{{ error }}</v-alert>
        <v-alert v-if="message" type="success">{{ message }}</v-alert>
        <v-table>
            <thead>
                <tr>
                    <th>Код</th>
                    <th>Название</th>
                    <th>FBS</th>
                    <th>FBO</th>
                    <th>Цена покупателю Ozon</th>
                    <th>База расчёта</th>
                    <th>Прибыль при текущей цене</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{{ value.offer_id }}</td>
                    <td>{{ value.name }}</td>
                    <td>{{ value.fbsCount }}</td>
                    <td>{{ value.fboCount }}</td>
                    <td>{{ money(buyer?.price ?? Number(value.marketing_seller_price)) }}</td>
                    <td>{{ money(result?.base ?? value.incoming_price) }}</td>
                    <td :class="{ 'bg-orange': warn }">
                        {{ money(buyer?.profit)
                        }}<template v-if="buyer"> / {{ buyer.profitPercent.toFixed(2) }}%</template>
                    </td>
                </tr>
            </tbody>
        </v-table>
        <v-row class="mt-3">
            <v-col cols="12" sm="4"
                ><v-text-field
                    v-model="value.available_price"
                    type="number"
                    min="0"
                    label="Рыночная база за упаковку, ₽"
                    hint="0 — использовать закупочную цену"
                    persistent-hint
                    :disabled="busy"
            /></v-col>
            <v-col cols="12" sm="4"
                ><v-text-field v-model="value.adv_perc" type="number" min="0" label="Реклама, %" :disabled="busy"
            /></v-col>
            <v-col cols="12" sm="4"
                ><v-text-field v-model="value.sum_pack" type="number" min="0" label="Упаковка, ₽" :disabled="busy"
            /></v-col>
        </v-row>
        <div class="d-flex flex-wrap ga-2 my-3">
            <v-btn :disabled="busy" @click="run(() => store.reloadCurrent(ind))">Загрузить текущие цены</v-btn>
            <v-btn :disabled="busy" :loading="store.ozonPricingLoading[value.offer_id]" @click="calculateNow"
                >Пересчитать</v-btn
            >
            <v-btn
                :disabled="busy || value.fbsCount + value.fboCount === 0"
                @click="run(() => store.calculatePercents(ind))"
                >Подобрать проценты</v-btn
            >
            <v-btn
                :disabled="busy || !dirty"
                @click="run(() => store.saveSettings(ind), 'Настройки сохранены. Цены на площадки не отправлялись.')"
                >Сохранить настройки</v-btn
            >
            <PriceSendDialog
                :offer-id="value.offer_id"
                :settings-key="settingsKey"
                :disabled="busy || dirty"
                @sent="
                    store.reloadCurrent(ind).catch(() => {
                        error = 'Не удалось обновить текущие цены после отправки';
                    })
                "
            />
        </div>
        <p v-if="dirty" class="text-body-2">
            Есть несохранённые настройки. Расчёт предварительный; перед отправкой сохраните настройки.
        </p>
        <OzonPricingResult :result="result" :loading="store.ozonPricingLoading[value.offer_id]">
            <template #markup="{ level }"
                ><v-text-field
                    v-model="value[markupFields[level]]"
                    type="number"
                    min="0"
                    :aria-label="`Заданный процент: ${level}`"
                    suffix="%"
                    hide-details
                    :disabled="busy"
                    style="max-width: 120px"
            /></template>
        </OzonPricingResult>
        <v-divider :thickness="3" />
        <PricePromo :offer-id="value.offer_id" />
    </div>
</template>
