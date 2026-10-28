<script setup lang="ts">
import Tariff from "@/components/Tariff.vue";
import Articles from "@/components/Articles.vue";
import Prices from "@/components/Prices.vue";
import { computed, ref, watch } from "vue";
import ScanFbs from "@/components/ScanFbs.vue";
import OzonFbsLabels from "@/components/OzonFbsLabels.vue";
import SupplyWbFbs from "@/components/SupplyWbFbs.vue";
import OzonProductCreate from "@/components/OzonProductCreate.vue";
import WbCopyProduct from "@/components/WbCopyProduct.vue";
import Chz from "@/components/Chz.vue";
import TnvedSync from "@/components/TnvedSync.vue";
import Dict from "@/components/Dict.vue";
import FboShortage from "@/components/FboShortage.vue";
import MpReturns from "@/components/MpReturns.vue";
import FboSupplyQr from "@/components/FboSupplyQr.vue";
import OzonPromoSweep from "@/components/OzonPromoSweep.vue";
import { postingStore } from "@/stores/postings";
import { useRoute, useRouter } from "vue-router";

/**
 * Меню в два уровня: группа сверху, вкладки группы под ней. Новая вкладка — строкой в groups, не в верхнее меню.
 * Источник правды — одна выбранная вкладка (tab), группа вычисляется из неё: переходы между вкладками
 * (заказ из этикеток → «Скан FBS») меняют только tab. Вкладка живёт в адресе ?tab= — F5 оставляет на месте.
 */
const groups = [
    { value: 'prices-group', title: 'Цены', tabs: [
        { value: 'prices', title: 'Цены' },
        { value: 'ozon-promo', title: 'Акции Ozon' },
    ] },
    { value: 'shipping', title: 'Отгрузки', tabs: [
        { value: 'scan-fbs', title: 'Скан FBS' },
        { value: 'ozon-fbs-labels', title: 'OZON FBS этикетки' },
        { value: 'supply-wb-fbs', title: 'WB FBS поставка' },
        { value: 'fbo-shortage', title: 'Недобор FBO' },
        { value: 'fbo-supply-qr', title: 'QR поставки FBO' },
    ] },
    { value: 'cards', title: 'Карточки', tabs: [
        { value: 'ozon-product', title: 'Добавить товар на Озон' },
        { value: 'wb-copy', title: 'Копировать в WB' },
        { value: 'tnved', title: 'ТН ВЭД' },
        { value: 'dict', title: 'Справочники МП' },
    ] },
    { value: 'stock', title: 'Склад', tabs: [
        { value: 'chz', title: 'ЧЗ' },
        { value: 'mp-returns', title: 'Возвраты' },
    ] },
];
const DEFAULT_TAB = 'prices';
const posting = postingStore();
const groupOf = (t: string) => groups.find((g) => g.tabs.some((x) => x.value === t)) ?? groups[0];

const route = useRoute();
const router = useRouter();
const fromQuery = String(route.query.tab ?? '');
const tab = ref(groups.some((g) => g.tabs.some((x) => x.value === fromQuery)) ? fromQuery : DEFAULT_TAB);
/** Последняя открытая вкладка в каждой группе — вернуться в группу туда же, где был. */
const lastInGroup: Record<string, string> = {};

const group = computed({
    get: () => groupOf(tab.value).value,
    set: (g: string) => {
        const target = groups.find((x) => x.value === g) ?? groups[0];
        tab.value = lastInGroup[target.value] ?? target.tabs[0].value;
    },
});
const groupTabs = computed(() => groupOf(tab.value).tabs);

watch(tab, (t) => {
    lastInGroup[groupOf(t).value] = t;
    if (route.query.tab !== t) router.replace({ query: { ...route.query, tab: t } });
}, { immediate: true });
const scanOrder = ref('');
// Счётчик кликов — растёт при каждом клике, чтобы повторный клик ТЕМ ЖЕ заказом тоже сработал.
const scanNonce = ref(0);

// Клик по номеру заказа в гриде OZON FBS этикетки → перейти на «Скан FBS» и загрузить заказ.
function openScan(order: string) {
    scanOrder.value = order;
    scanNonce.value++;
    tab.value = 'scan-fbs';
}

// Заказ успешно завершён в «Скан FBS» → убираем его из списка «OZON FBS этикетки».
function onScanSuccess(order: string) {
    posting.removeByPostingNumber(order);
}
</script>

<template>
    <v-card>
        <v-tabs bg-color="primary" :model-value="group" @update:model-value="(v) => v && (group = String(v))">
            <v-tab v-for="g in groups" :key="g.value" :value="g.value">{{ g.title }}</v-tab>
        </v-tabs>
        <!-- key по группе: строка пересоздаётся, иначе Vuetify на миг не находит tab среди новых вкладок и откатывает его -->
        <v-tabs :key="group" :model-value="tab" @update:model-value="(v) => v && (tab = String(v))"
                :mandatory="false" density="compact" color="primary">
            <v-tab v-for="t in groupTabs" :key="t.value" :value="t.value">{{ t.title }}</v-tab>
        </v-tabs>
        <v-divider />

        <v-card-text>
            <v-tabs-window v-model="tab">
                <v-tabs-window-item value="prices">
                    <Tariff class="pa-2"/>
                    <v-divider :thickness="5" />
                    <Articles class="pa-2" />
                    <v-divider :thickness="5" />
                    <Prices class="pa-2" />
                </v-tabs-window-item>

                <v-tabs-window-item value="ozon-promo">
                    <OzonPromoSweep class="pa-2"/>
                </v-tabs-window-item>

                <v-tabs-window-item value="scan-fbs">
                    <scan-fbs class="pa-2" :prefill="scanOrder" :prefill-nonce="scanNonce" @success="onScanSuccess"/>
                </v-tabs-window-item>

                <v-tabs-window-item value="ozon-fbs-labels">
                    <ozon-fbs-labels class="pa-2" @pick-order="openScan"/>
                </v-tabs-window-item>

                <v-tabs-window-item value="supply-wb-fbs">
                    <supply-wb-fbs class="pa-2"/>
                </v-tabs-window-item>

                <v-tabs-window-item value="ozon-product">
                    <OzonProductCreate class="pa-2"/>
                </v-tabs-window-item>

                <v-tabs-window-item value="wb-copy">
                    <WbCopyProduct class="pa-2"/>
                </v-tabs-window-item>

                <v-tabs-window-item value="chz">
                    <Chz class="pa-2"/>
                </v-tabs-window-item>
                <v-tabs-window-item value="fbo-shortage">
                    <FboShortage class="pa-2"/>
                </v-tabs-window-item>
                <v-tabs-window-item value="fbo-supply-qr">
                    <FboSupplyQr class="pa-2"/>
                </v-tabs-window-item>
                <v-tabs-window-item value="mp-returns">
                    <MpReturns class="pa-2"/>
                </v-tabs-window-item>

                <v-tabs-window-item value="tnved">
                    <TnvedSync class="pa-2"/>
                </v-tabs-window-item>
                <v-tabs-window-item value="dict">
                    <Dict class="pa-2"/>
                </v-tabs-window-item>
            </v-tabs-window>
        </v-card-text>
    </v-card>
</template>
