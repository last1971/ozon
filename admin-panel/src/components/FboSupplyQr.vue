<script setup lang="ts">
import { fboSupplyQrStore, type SupplyBox } from "@/stores/fboSupplyQr";
import { computed, nextTick, ref } from "vue";
import UsernameField from "./UsernameField.vue";

/**
 * QR-этикетки экземпляров поставки FBO Озона (размещение в ПВЗ): файл Озона → скан коробки →
 * пары «этикетка ii… + товар» в любом порядке → тот же файл с заполненным QR.
 */
const store = fboSupplyQrStore();
const scanInput = ref('');
const scanField = ref<any>(null);
const fileInput = ref<File | File[] | null>(null);
const confirmDownload = ref(false);
/** Раскрытые строки «коробка|артикул» — список наклеенных этикеток. */
const open = ref<Record<string, boolean>>({});

const userOk = computed(() => store.username.trim().length > 0);
const lastInBox = computed(() => store.lastInBox());
const incomplete = computed(() => store.totals.done < store.totals.need);

async function onFile(v: File | File[] | null) {
    const file = Array.isArray(v) ? v[0] : v;
    if (file) await store.load(file);
    focusScan();
}

async function onScan() {
    const raw = scanInput.value;
    scanInput.value = '';
    await store.scan(raw);
    focusScan();
}

async function choose(offerId: string) {
    await store.chooseOffer(offerId);
    focusScan();
}

function download() {
    confirmDownload.value = false;
    store.download();
}

function focusScan() {
    nextTick(() => scanField.value?.focus());
}

const key = (cargoId: string, offerId: string) => `${cargoId}|${offerId}`;
const boundOf = (cargoId: string, offerId: string) => store.bound.filter((b) => b.cargoId === cargoId && b.offerId === offerId);
const boxState = (b: SupplyBox) => (store.boxDone(b) ? 'success' : b.cargoId === store.cargoId ? 'primary' : undefined);
const fmtTime = (d: string) => new Date(d).toLocaleTimeString().slice(0, 5);
</script>

<template>
    <v-container fluid class="pa-0">
        <v-row dense class="mb-2" align="center">
            <v-col cols="12" md="5">
                <v-file-input v-model="fileInput" label="Файл Озона «Состав грузомест» (xlsx)" accept=".xlsx" density="compact"
                              hide-details prepend-icon="mdi-file-excel" :loading="store.isLoading" @update:model-value="onFile" />
            </v-col>
            <v-col cols="12" md="3">
                <UsernameField v-model="store.username" label="Кто собирает" />
            </v-col>
            <v-col cols="12" md="4" class="d-flex align-center justify-end">
                <span v-if="store.boxes.length" class="me-3 text-body-2">Наклеено {{ store.totals.done }} из {{ store.totals.need }}</span>
                <v-btn color="primary" prepend-icon="mdi-download" :disabled="!store.boxes.length" :loading="store.isLoading"
                       @click="incomplete ? (confirmDownload = true) : download()">Скачать файл для Озона</v-btn>
            </v-col>
        </v-row>

        <v-text-field
            ref="scanField"
            v-model="scanInput"
            :label="store.hint"
            prepend-inner-icon="mdi-barcode-scan"
            density="comfortable"
            autofocus
            :disabled="!userOk"
            :hint="userOk ? '' : 'Сначала укажите, кто собирает'"
            persistent-hint
            :loading="store.isLoading"
            @keydown.enter="onScan"
        />

        <v-alert v-if="store.errorMessage" type="error" density="compact" class="mb-2" closable @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>
        <v-alert v-else-if="store.info" type="info" variant="tonal" density="compact" class="mb-2">{{ store.info }}</v-alert>

        <!-- Товар подходит к нескольким артикулам коробки (фасовки) — выбрать -->
        <v-card v-if="store.pending.product && !store.pending.product.offerId" variant="outlined" class="mb-2 pa-2">
            <span class="me-2">{{ store.pending.product.resolved.name }} — какой артикул?</span>
            <v-btn v-for="o in store.pending.product.resolved.offerIds" :key="o" class="me-2" variant="tonal" @click="choose(o)">{{ o }}</v-btn>
        </v-card>

        <div v-if="store.pending.qr || store.pending.product" class="mb-2 text-body-2">
            Ждёт пары:
            <v-chip v-if="store.pending.qr" size="small" class="me-1">{{ store.pending.qr }}</v-chip>
            <v-chip v-if="store.pending.product" size="small" class="me-1">
                {{ store.pending.product.offerId ?? store.pending.product.resolved.goodscode }}
                <span v-if="store.pending.product.resolved.ki">&nbsp;· КМ</span>
            </v-chip>
            <v-btn size="x-small" variant="text" @click="store.resetPending(); focusScan()">сбросить</v-btn>
        </div>

        <v-table v-if="store.boxes.length" density="compact">
            <thead>
                <tr><th>Коробка</th><th>Артикул</th><th>Наименование</th><th class="text-end">Нужно</th><th class="text-end">Наклеено</th><th></th></tr>
            </thead>
            <tbody>
                <template v-for="b in store.boxes" :key="b.cargoId">
                    <template v-for="(l, i) in b.lines" :key="key(b.cargoId, l.offerId)">
                        <tr :class="b.cargoId === store.cargoId ? 'bg-blue-lighten-5' : ''">
                            <td>
                                <v-chip v-if="i === 0" size="small" :color="boxState(b)" variant="flat">
                                    {{ b.cargoId }}<v-icon v-if="store.boxDone(b)" end icon="mdi-check" />
                                </v-chip>
                            </td>
                            <td>{{ l.offerId }}</td>
                            <td>{{ l.name ?? '—' }}<span v-if="l.goodscode === null" class="text-error"> (не наш артикул)</span></td>
                            <td class="text-end">{{ l.need }}</td>
                            <td class="text-end" :class="store.doneOf(b.cargoId, l.offerId) >= l.need ? 'text-success' : ''">
                                {{ store.doneOf(b.cargoId, l.offerId) }}
                            </td>
                            <td>
                                <v-btn v-if="store.doneOf(b.cargoId, l.offerId)" size="x-small" variant="text"
                                       :icon="open[key(b.cargoId, l.offerId)] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                                       @click="open[key(b.cargoId, l.offerId)] = !open[key(b.cargoId, l.offerId)]" />
                            </td>
                        </tr>
                        <tr v-for="q in open[key(b.cargoId, l.offerId)] ? boundOf(b.cargoId, l.offerId) : []" :key="q.qr" class="text-caption">
                            <td></td>
                            <td colspan="3">{{ q.qr }}<span v-if="q.ki" class="ms-2 text-medium-emphasis">КМ {{ q.ki }}</span></td>
                            <td class="text-end">{{ q.username }} {{ fmtTime(q.createdAt) }}</td>
                            <td><v-btn size="x-small" variant="text" icon="mdi-close" @click="store.unbind(q.qr)" /></td>
                        </tr>
                    </template>
                </template>
            </tbody>
        </v-table>

        <div v-if="lastInBox" class="mt-2">
            <v-btn variant="tonal" size="small" prepend-icon="mdi-undo" @click="store.unbind(lastInBox.qr); focusScan()">
                Отменить последнюю ({{ lastInBox.qr }} → {{ lastInBox.offerId }})
            </v-btn>
        </div>

        <v-dialog v-model="confirmDownload" max-width="460">
            <v-card>
                <v-card-title>Не всё наклеено</v-card-title>
                <v-card-text>Наклеено {{ store.totals.done }} из {{ store.totals.need }}. Озон примет файл, только когда QR есть в каждой строке. Скачать как есть?</v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="confirmDownload = false">Отмена</v-btn>
                    <v-btn color="primary" @click="download">Скачать</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-container>
</template>
