<script setup lang="ts">
import { mpReturnsStore } from "@/stores/mpReturns";
import UsernameField from "./UsernameField.vue";
import { RETURN_SERVICES, type MpService, type ReturnCard, type ReturnRowStatus } from "@/contracts/mp-return.dto";
import { computed, nextTick, onMounted, ref } from "vue";

const store = mpReturnsStore();
const scanInput = ref('');
const scanField = ref<any>(null);
const serviceOf = (service: MpService) => RETURN_SERVICES.find((s) => s.value === service);

onMounted(() => {
    store.loadList();
    store.loadReasons();
    focusScan();
});

const card = computed(() => store.card);
/** Код маркировки: (01)GTIN(14)(21)… — всё остальное считаем сканом посылки. */
const isMarkScan = (text: string) => /^\(?01\)?\d{14}\(?21\)?/.test(text.trim());
/** Штуки по отсканированным маркам, которые есть на строках этих карточек (количественный код — своим количеством). */
function scannedPieces(cards: ReturnCard[]): number {
    const codes = cards.filter((c) => c.marksRequired).flatMap((c) => c.codes);
    return store.markScans.reduce((sum, raw) => {
        const code = codes.find((k) => raw.trim().startsWith(k.ki) || raw.replace(/\((\d{2})\)/g, '$1').startsWith(k.ki));
        return sum + (code?.quantity ?? 0);
    }, 0);
}
/** Сколько штук должны покрыть марки. */
const neededPieces = (cards: ReturnCard[]) => cards.filter((c) => c.marksRequired).reduce((sum, c) => sum + c.quan, 0);
const marksOk = (cards: ReturnCard[]) => scannedPieces(cards) === neededPieces(cards);
const userOk = computed(() => store.username.trim().length > 0);
const canAcceptAll = (cards: ReturnCard[]) =>
    cards.length > 0 && cards.every((c) => c.canAccept) && marksOk(cards) && userOk.value && !store.isSaving;
const canReturn = computed(() => !!card.value && canAcceptAll([card.value]));

/** Посылка: необработанные возвраты, если их больше одного — для кнопок «все». */
const groupCards = computed(() => store.cards.filter((c) => !c.accepted));
const isGroup = computed(() => groupCards.value.length > 1);
const canReturnGroup = computed(() => isGroup.value && canAcceptAll(groupCards.value));
/** «SSR-40AA-H × 25 шт» по каждому товару посылки. */
const groupSummary = computed(() => {
    const byGoods = new Map<string, number>();
    for (const c of groupCards.value) {
        const name = c.invoiceLine?.name ?? c.line.productName ?? c.line.offerId;
        byGoods.set(name, (byGoods.get(name) ?? 0) + c.quan);
    }
    return [...byGoods].map(([name, quan]) => `${name} × ${quan} шт`).join(', ');
});
/** Марки сканируют на то, что принимают: всю посылку или одну карточку. */
const marksScope = computed<ReturnCard[]>(() => (isGroup.value ? groupCards.value : card.value ? [card.value] : []));
const marksExpected = computed(() => marksScope.value.some((c) => c.marksRequired && c.canAccept));

async function onScan() {
    const text = scanInput.value;
    scanInput.value = '';
    if (marksExpected.value && isMarkScan(text)) store.addMarkScan(text);
    else await store.lookup(text);
    focusScan();
}
function focusScan() {
    nextTick(() => scanField.value?.focus());
}
async function act(action: 'return' | 'return-writeoff' | 'problem', cards?: ReturnCard[]) {
    await store.act(action, cards);
    focusScan();
}
async function writeOff() {
    await store.writeOff();
    focusScan();
}

const STATUS: Record<ReturnRowStatus, { text: string; color: string }> = {
    pending: { text: 'не принят', color: 'primary' },
    blocked: { text: 'нельзя принять', color: 'error' },
    accepted: { text: 'принят', color: 'success' },
    'written-off': { text: 'принят и списан', color: 'success' },
    problem: { text: 'проблема', color: 'warning' },
};
const INVOICE_STATUS: Record<number, string> = { 0: 'расформирован', 1: 'сформирован', 2: 'резерв', 3: 'в подборке', 4: 'подобран', 5: 'закрыт', 6: 'корзина' };
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');
</script>

<template>
    <v-container fluid class="pa-0">
        <v-alert v-if="store.errorMessage" type="error" closable class="mb-4" @click:close="store.errorMessage = ''">
            {{ store.errorMessage }}
        </v-alert>
        <v-alert v-if="store.okMessage" type="success" closable class="mb-4" @click:close="store.okMessage = ''">
            {{ store.okMessage }}
        </v-alert>

        <v-row dense align="center" class="mb-2">
            <v-col cols="12" md="2">
                <v-select v-model="store.service" :items="RETURN_SERVICES" item-title="title" item-value="value" label="Маркетплейс" density="compact" hide-details @update:model-value="store.loadList()" />
            </v-col>
            <v-col cols="6" md="2">
                <v-text-field v-model="store.from" type="date" label="Получены с" density="compact" hide-details />
            </v-col>
            <v-col cols="6" md="2">
                <v-text-field v-model="store.to" type="date" label="по" density="compact" hide-details />
            </v-col>
            <v-col cols="6" md="2">
                <v-checkbox v-model="store.onlyPending" label="только непринятые" density="compact" hide-details />
            </v-col>
            <v-col cols="6" md="1">
                <v-btn :loading="store.isLoading" variant="tonal" @click="store.loadList()">Обновить</v-btn>
            </v-col>
            <v-col cols="12" md="3">
                <UsernameField v-model="store.username" label="Кто принимает" />
            </v-col>
        </v-row>

        <v-text-field
            ref="scanField"
            v-model="scanInput"
            :label="marksExpected ? 'Скан марки или новой посылки' : serviceOf(store.service)?.scanHint"
            prepend-inner-icon="mdi-barcode-scan"
            density="comfortable"
            autofocus
            :loading="store.isLoading"
            @keydown.enter="onScan"
        />

        <!-- Карточка возврата -->
        <v-card v-if="card" variant="outlined" class="mb-4">
            <v-tabs v-if="store.cards.length > 1" :model-value="store.cardIndex" density="compact" @update:model-value="store.selectCard(Number($event))">
                <v-tab v-for="(c, i) in store.cards" :key="c.line.extId" :value="i">{{ c.line.offerId }}</v-tab>
            </v-tabs>
            <v-alert v-if="isGroup" type="info" variant="tonal" density="compact" class="ma-3">
                <div>
                    В посылке {{ store.cards.length }} возвратов, не обработано <b>{{ groupCards.length }}</b>: {{ groupSummary }}
                </div>
                <div v-if="groupCards.some((c) => !c.canAccept)" class="text-error">
                    Все сразу принять нельзя: есть возвраты с запретом — смотрите их вкладки
                </div>
                <div class="mt-2">
                    <v-btn color="primary" variant="flat" class="me-2" :disabled="!canReturnGroup" :loading="store.isSaving" @click="act('return', groupCards)">
                        Вернуть все ({{ groupCards.length }})
                    </v-btn>
                    <v-btn color="primary" variant="tonal" :disabled="!canReturnGroup || !store.osnSpisId" :loading="store.isSaving" @click="act('return-writeoff', groupCards)">
                        Вернуть и списать все ({{ groupCards.length }})
                    </v-btn>
                </div>
            </v-alert>
            <v-card-title class="text-subtitle-1 d-flex align-center">
                Возврат {{ card.line.extId }} · {{ card.line.posting }} · {{ card.line.schema ?? '' }}
                <v-spacer />
                <v-btn icon="mdi-close" variant="text" size="small" @click="store.closeCard()" />
            </v-card-title>
            <v-card-text>
                <div v-if="card.invoice">
                    Счёт <b>№{{ card.invoice.number }}</b> от {{ fmtDate(card.invoice.date) }},
                    {{ INVOICE_STATUS[card.invoice.status] ?? card.invoice.status }}<span v-if="card.invoice.isDonor">, донор</span>
                </div>
                <div class="text-h6 my-1">{{ card.invoiceLine?.name ?? card.line.productName }}</div>
                <div>
                    Вернулось: {{ card.line.units }} × фасовка {{ card.pieces }} = <b>{{ card.quan }} шт</b>
                    <span v-if="card.invoiceLine"> · подобрано на строке {{ card.invoiceLine.picked }}</span>
                </div>
                <div>Причина: {{ card.line.reason ?? '—' }} ({{ card.line.isBuyout ? 'после выкупа' : 'отмена до выкупа' }})</div>
                <div class="text-medium-emphasis">{{ serviceOf(card.line.service)?.title }}: {{ card.line.stateName ?? '—' }}, получен {{ fmtDateTime(card.line.receivedAt) }}</div>

                <v-alert v-for="w in card.warnings" :key="w" type="warning" density="compact" variant="tonal" class="mt-2">{{ w }}</v-alert>
                <v-alert v-for="b in card.blockers" :key="b" type="error" density="compact" variant="tonal" class="mt-2">{{ b }}</v-alert>

                <div v-if="card.accepted" class="mt-3">
                    <v-chip :color="card.accepted.decision === 'PROBLEM' ? 'warning' : 'success'">
                        {{ card.accepted.decision === 'PROBLEM' ? 'Отмечен проблемой' : 'Принят' }}
                        {{ fmtDateTime(card.accepted.createdAt) }}, {{ card.accepted.username }}
                    </v-chip>
                    <v-chip v-if="card.accepted.spisCode" class="ms-2" color="success">Списан, документ {{ card.accepted.spisCode }}</v-chip>
                    <div v-if="card.accepted.comment" class="mt-1">Комментарий: {{ card.accepted.comment }}</div>
                </div>

                <div v-if="marksExpected" class="mt-3">
                    <div :class="marksOk(marksScope) ? 'text-success' : 'text-error'">
                        Марки{{ isGroup ? ' на всю посылку' : '' }}: отсканировано на {{ scannedPieces(marksScope) }} из {{ neededPieces(marksScope) }} шт
                    </div>
                    <v-chip v-for="s in store.markScans" :key="s" closable class="me-1 mt-1" @click:close="store.removeMarkScan(s)">
                        {{ s.slice(0, 31) }}…
                    </v-chip>
                </div>

                <v-row v-if="card.canAccept || card.canWriteOff" dense class="mt-3">
                    <v-col cols="12" md="6">
                        <v-text-field v-model="store.comment" label="Комментарий (для «Проблема» обязателен)" density="compact" hide-details />
                    </v-col>
                    <v-col cols="12" md="6">
                        <v-select
                            v-model="store.osnSpisId"
                            :items="store.reasons"
                            item-title="name"
                            item-value="id"
                            label="Основание списания"
                            density="compact"
                            hide-details
                        />
                    </v-col>
                </v-row>
            </v-card-text>
            <v-card-actions v-if="card.canAccept || card.canWriteOff || !card.accepted">
                <template v-if="card.canAccept">
                    <v-btn color="primary" variant="flat" :disabled="!canReturn" :loading="store.isSaving" @click="act('return')">Вернуть на склад</v-btn>
                    <v-btn color="primary" variant="tonal" :disabled="!canReturn || !store.osnSpisId" :loading="store.isSaving" @click="act('return-writeoff')">
                        Вернуть и списать
                    </v-btn>
                </template>
                <v-btn v-if="card.canWriteOff" color="primary" variant="flat" :disabled="!userOk || !store.osnSpisId" :loading="store.isSaving" @click="writeOff">
                    Списать
                </v-btn>
                <v-btn v-if="!card.accepted" color="warning" variant="tonal" :disabled="!userOk || !store.comment.trim()" :loading="store.isSaving" @click="act('problem')">
                    Проблема
                </v-btn>
                <v-btn variant="text" @click="store.closeCard()">Отмена</v-btn>
            </v-card-actions>
        </v-card>

        <!-- Список полученных -->
        <v-card variant="outlined">
            <v-card-title class="text-subtitle-1">Получены маркетплейсом: {{ store.rows.length }}</v-card-title>
            <v-table v-if="store.rows.length" density="compact" hover>
                <thead>
                    <tr><th>Получен</th><th>Отправление</th><th>Счёт</th><th>Товар</th><th>Кол</th><th>Причина</th><th>Статус</th></tr>
                </thead>
                <tbody>
                    <tr v-for="r in store.rows" :key="r.line.extId" style="cursor: pointer" @click="store.lookup(r.line.posting)">
                        <td>{{ fmtDate(r.line.receivedAt) }}</td>
                        <td>{{ r.line.posting }}</td>
                        <td>{{ r.invoiceNumber ? '№' + r.invoiceNumber : '—' }}</td>
                        <td>{{ r.goodsName ?? r.line.offerId }}</td>
                        <td>{{ r.quan }}</td>
                        <td>{{ r.line.reason }}</td>
                        <td>
                            <v-chip size="small" :color="STATUS[r.status].color" :title="r.blockers.join('; ')">{{ STATUS[r.status].text }}</v-chip>
                        </td>
                    </tr>
                </tbody>
            </v-table>
        </v-card>
    </v-container>
</template>
