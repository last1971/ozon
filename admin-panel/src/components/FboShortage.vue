<script setup lang="ts">
import { fboShortageStore, pickKey, type DonorLine, type DonorRow } from "@/stores/fboShortage";
import { computed, onMounted, ref } from "vue";

const store = fboShortageStore();
const confirm = ref(false);

onMounted(() => store.loadShortages());

const offer = computed(() => store.offer);
const linesWithShortage = computed(() => offer.value?.lines.filter((l) => l.shortage > 0) ?? []);
const linesOk = computed(() => offer.value?.lines.filter((l) => l.shortage <= 0) ?? []);

const nominalOf = (l: DonorLine) => l.pieces ?? Number(store.nominals[String(l.realpricecode)] ?? 0);
const takenOf = (l: DonorLine) => store.takenByLine[l.realpricecode] ?? 0;
const pickOf = (l: DonorLine, d: DonorRow) => store.picks[pickKey(l.realpricecode, d.podbposcode)] ?? null;
/** Максимум для поля: остаток недобора строки плюс уже введённое здесь, но не больше доступного у донора с учётом других строк. */
const maxOf = (l: DonorLine, d: DonorRow) => {
    const mine = pickOf(l, d) ?? 0;
    const lineRoom = l.shortage - takenOf(l) + mine;
    const donorRoom = d.quantity - (store.takenByDonor[d.podbposcode] ?? 0) + mine;
    return Math.max(0, Math.min(lineRoom, donorRoom));
};
const lineState = (l: DonorLine) => {
    const taken = takenOf(l);
    if (taken === 0) return 'untouched';
    return taken === l.shortage && nominalOf(l) > 0 ? 'ok' : 'bad';
};
const summary = computed(() =>
    linesWithShortage.value
        .filter((l) => takenOf(l) > 0)
        .map((l) => {
            const parts = l.donors
                .filter((d) => pickOf(l, d))
                .map((d) => `${pickOf(l, d)} со счёта №${d.invoiceNumber}`);
            return `${l.name ?? l.goodscode}: ${parts.join(', ')}`;
        }),
);

function pick(posting: string) {
    store.posting = posting;
    store.loadOffer();
}
async function apply() {
    confirm.value = false;
    await store.apply();
}
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '');
</script>

<template>
    <v-container fluid class="pa-0">
        <v-alert v-if="store.errorMessage" type="error" closable class="mb-4" @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>

        <!-- Журнал открытых недоборов -->
        <v-card variant="outlined" class="mb-4">
            <v-card-title class="text-subtitle-1 d-flex align-center">
                Открытые недоборы: {{ store.shortages.length }}
                <v-btn variant="text" size="small" icon="mdi-refresh" class="ms-2" @click="store.loadShortages()" />
            </v-card-title>
            <v-table v-if="store.shortages.length" density="compact" hover>
                <thead>
                    <tr><th>Маркет</th><th>Отправление</th><th>Товар</th><th>Не хватает</th><th>Склад</th><th>Когда</th></tr>
                </thead>
                <tbody>
                    <tr v-for="s in store.shortages" :key="`${s.posting}:${s.goodscode}`" style="cursor: pointer" @click="pick(s.posting)">
                        <td>{{ s.service.toUpperCase() }}</td>
                        <td>{{ s.posting }}</td>
                        <td>{{ s.name ?? s.goodscode }} <span class="text-medium-emphasis">({{ s.goodscode }})</span></td>
                        <td>{{ s.quantity }}</td>
                        <td>{{ s.prim }}</td>
                        <td>{{ fmtDate(s.date) }}</td>
                    </tr>
                </tbody>
            </v-table>
            <v-card-text v-else class="text-medium-emphasis">Недоборов нет.</v-card-text>
        </v-card>

        <!-- Отправление -->
        <v-row dense align="center">
            <v-col cols="3">
                <v-text-field v-model="store.posting" label="Отправление" density="compact" hide-details @keyup.enter="store.loadOffer()" />
            </v-col>
            <v-col cols="auto">
                <v-btn color="primary" prepend-icon="mdi-magnify" :loading="store.isLoading" @click="store.loadOffer()">Найти доноров</v-btn>
            </v-col>
            <v-col v-if="store.offers.length > 1" cols="3">
                <v-select v-model="store.scode" :items="store.offers.map((o) => ({ value: o.scode, title: `№${o.invoiceNumber} · ${o.prim}` }))" label="Счёт" density="compact" hide-details />
            </v-col>
        </v-row>

        <!-- Результат применения -->
        <v-alert v-if="store.result" type="success" variant="tonal" class="mt-4" closable @click:close="store.result = null">
            <div v-for="m in store.result.moved" :key="`${m.realpricecode}:${m.donorInvoiceNumber}`">
                {{ m.goodscode }} × {{ m.quantity }} со счёта №{{ m.donorInvoiceNumber }}<span v-if="m.codes.length"> · коды: {{ m.codes.join(', ') }}</span>
            </div>
            <div class="mt-1">{{ store.result.shortageClosed ? 'Недобора не осталось' : 'По другим позициям недобор ещё открыт' }}{{ store.result.pickedUp ? ', счёт отдан в подбор.' : '.' }}</div>
        </v-alert>

        <template v-if="offer">
            <div class="mt-4 text-body-2 text-medium-emphasis">
                Счёт №{{ offer.invoiceNumber }} · {{ fmtDate(offer.date) }} · {{ offer.prim }} · статус {{ offer.status }}
                <span v-if="!offer.inShortage"> · в журнале недобора не числится</span>
            </div>

            <v-card v-for="l in linesWithShortage" :key="l.realpricecode" class="mt-3" variant="outlined"
                    :color="lineState(l) === 'ok' ? 'success' : lineState(l) === 'bad' ? 'error' : undefined">
                <v-card-title class="text-subtitle-1 d-flex align-center flex-wrap">
                    <span>{{ l.name ?? l.goodscode }} <span class="text-medium-emphasis">({{ l.goodscode }})</span></span>
                    <v-spacer />
                    <v-chip size="small" variant="tonal" class="me-2">нужно {{ l.quantity }}</v-chip>
                    <v-chip size="small" variant="tonal" class="me-2">подобрано {{ l.picked }}</v-chip>
                    <v-chip size="small" variant="tonal" color="warning" class="me-2">недобор {{ l.shortage }}</v-chip>
                    <v-chip size="small" variant="tonal" :color="lineState(l) === 'bad' ? 'error' : lineState(l) === 'ok' ? 'success' : undefined">
                        взято {{ takenOf(l) }} из {{ l.shortage }}
                    </v-chip>
                </v-card-title>
                <v-card-text>
                    <v-row v-if="l.pieces === null" dense align="center" class="mb-2">
                        <v-col cols="auto" class="text-body-2">Фасовка строки неизвестна (старый счёт), номинал кода:</v-col>
                        <v-col cols="2">
                            <v-text-field :model-value="store.nominals[String(l.realpricecode)]" type="number" min="1" density="compact" hide-details
                                          @update:model-value="(v: string) => (store.nominals[String(l.realpricecode)] = Number(v))" />
                        </v-col>
                    </v-row>
                    <v-table v-if="l.donors.length" density="compact">
                        <thead>
                            <tr><th>Счёт-донор</th><th>Дата</th><th>Примечание</th><th>Подобрано</th><th>Коды (живых / номинала)</th><th>Взять</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="d in l.donors" :key="d.podbposcode" :class="{ 'text-disabled': d.canTake === false }">
                                <td>№{{ d.invoiceNumber }}</td>
                                <td>{{ fmtDate(d.date) }}</td>
                                <td>{{ d.prim }}</td>
                                <td>{{ d.quantity }}</td>
                                <td>
                                    {{ d.codesLive ?? 0 }} / {{ d.codesNominal ?? 0 }}
                                    <span v-if="d.codesDead" class="text-warning"> · выведенных {{ d.codesDead }}</span>
                                    <div v-if="d.canTake === false" class="text-caption text-error">{{ d.reason }}</div>
                                </td>
                                <td style="width: 140px">
                                    <v-text-field
                                        :model-value="pickOf(l, d)"
                                        type="number"
                                        :min="0"
                                        :max="maxOf(l, d)"
                                        :step="nominalOf(l) || 1"
                                        :disabled="d.canTake === false || store.isApplying"
                                        density="compact"
                                        hide-details
                                        @update:model-value="(v: string) => store.setPick(l.realpricecode, d.podbposcode, Math.min(Number(v) || 0, maxOf(l, d)))"
                                    />
                                </td>
                            </tr>
                        </tbody>
                    </v-table>
                    <div v-else class="text-medium-emphasis">Доноров нет: у покупателя нет сформированных счетов с этим товаром.</div>
                </v-card-text>
            </v-card>

            <v-expansion-panels v-if="linesOk.length" class="mt-3">
                <v-expansion-panel :title="`Строки без недобора: ${linesOk.length}`">
                    <v-expansion-panel-text>
                        <span v-for="l in linesOk" :key="l.realpricecode" class="me-4">{{ l.name ?? l.goodscode }} × {{ l.quantity }}</span>
                    </v-expansion-panel-text>
                </v-expansion-panel>
            </v-expansion-panels>

            <v-row dense class="mt-4" align="center">
                <v-col cols="auto">
                    <v-btn color="warning" prepend-icon="mdi-swap-horizontal" :disabled="!store.canApply || store.isApplying" :loading="store.isApplying" @click="confirm = true">
                        Перенести
                    </v-btn>
                </v-col>
                <v-col v-if="!store.canApply && Object.keys(store.picks).length" cols="auto" class="text-body-2 text-error">
                    По каждой тронутой строке сумма должна равняться недобору ровно.
                </v-col>
            </v-row>
        </template>

        <v-dialog v-model="confirm" max-width="560">
            <v-card>
                <v-card-title>Перенести с доноров?</v-card-title>
                <v-card-text>
                    <div v-for="s in summary" :key="s">{{ s }}</div>
                    <div class="mt-2 text-medium-emphasis">Коды маркировки переедут вместе с товаром. Отменить перенос кнопкой нельзя.</div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="confirm = false">Отмена</v-btn>
                    <v-btn color="warning" @click="apply">Перенести</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-container>
</template>

<style scoped>

</style>
