<script setup lang="ts">
import { onMounted, ref } from "vue";
import axios from "../axios.config";

// Вкладка «ЧЗ»: передача кодов маркировки в ГИС МТ.
// Точка правды — бэк (/api/chz/*): здесь только отображение и действия —
// скачать пачку, подтвердить пачку, обновить списки.
//
// Вывод бывает двух видов. Продажи маркетплейса уходят одной пачкой на все
// коды. Вывод по УПД (покупателю вне ЧЗ) — пачка на КАЖДЫЙ документ: в ГИС МТ
// вывод оформляется по документу, там нужны его номер и дата, поэтому в
// третьем списке строки — не коды, а сами УПД.

interface PendingCode {
    ki: string;
    goodsCode: string;
    price: number | null;
    invoiceNumber: number | null;
    posting: string | null;
    since: string | null;
}

interface PendingDoc {
    sfcode: number;
    nsf: number | null;
    date: string | null;
    buyer: string | null;
    cnt: number;
    since: string | null;
}

interface BatchInfo {
    id: number;
    kind: 'retire' | 'return' | 'retire_upd';
    createdAt: string;
    confirmedAt: string | null;
    cnt: number;
    sfcode: number | null;
    nsf: number | null;
    date: string | null;
}

const retire = ref<PendingCode[]>([]);
const giveBack = ref<PendingCode[]>([]);
const upd = ref<PendingDoc[]>([]);
const batches = ref<BatchInfo[]>([]);
const busy = ref(false);
const message = ref('');
const error = ref('');

const headers = [
    { title: 'КИ', key: 'ki' },
    { title: 'Товар', key: 'goodsCode' },
    { title: 'Счёт', key: 'invoiceNumber' },
    { title: 'Отправление', key: 'posting' },
    { title: 'Цена', key: 'price' },
    { title: 'Ждёт с', key: 'since' },
];

const docHeaders = [
    { title: 'УПД №', key: 'nsf' },
    { title: 'Дата', key: 'date' },
    { title: 'Покупатель', key: 'buyer' },
    { title: 'КИ', key: 'cnt' },
    { title: 'Ждёт с', key: 'since' },
    { title: '', key: 'actions', sortable: false },
];

const kindTitle = (kind: BatchInfo['kind']) =>
    kind === 'retire' ? 'вывод из оборота' : kind === 'retire_upd' ? 'вывод по УПД' : 'возврат в оборот';
const fmtDate = (value: string | null) => (value ? new Date(value).toLocaleString('ru-RU') : '');
const fmtDay = (value: string | null) => (value ? new Date(value).toLocaleDateString('ru-RU') : '');
const batchDoc = (batch: BatchInfo) => (batch.kind === 'retire_upd' ? `№${batch.nsf ?? batch.sfcode} от ${fmtDay(batch.date)}` : '');

async function refresh() {
    error.value = '';
    try {
        const pending = await axios.get<{ retire: PendingCode[]; giveBack: PendingCode[]; upd: PendingDoc[] }>(
            '/api/chz/pending',
        );
        retire.value = pending.data.retire;
        giveBack.value = pending.data.giveBack;
        upd.value = pending.data.upd;
        const history = await axios.get<BatchInfo[]>('/api/chz/batches');
        batches.value = history.data;
    } catch (e: any) {
        error.value = e?.response?.data?.message ?? e?.message ?? 'Ошибка загрузки';
    }
}

async function fetchFile(id: number, filename: string) {
    const file = await axios.get(`/api/chz/batch/${id}/file`, { responseType: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([file.data]));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

// «Скачать» = зафиксировать пачку из текущего списка и получить её файл.
// Подтверждается потом ровно эта пачка — из истории, даже после перезагрузки страницы.
async function download(kind: 'retire' | 'return') {
    busy.value = true;
    error.value = '';
    try {
        const batch = await axios.post<{ id: number; cnt: number }>(`/api/chz/batch/${kind}`);
        await fetchFile(batch.data.id, `${kind === 'retire' ? 'vyvod_iz_oborota' : 'vozvrat_v_oborot'}_${batch.data.id}.xlsx`);
        message.value = `Пачка №${batch.data.id}: ${batch.data.cnt} КИ. Выгрузи файл в ГИС МТ и нажми «Подтвердить» в истории.`;
        await refresh();
    } catch (e: any) {
        error.value = e?.response?.data?.message ?? e?.message ?? 'Ошибка';
    } finally {
        busy.value = false;
    }
}

async function downloadDoc(doc: PendingDoc) {
    busy.value = true;
    error.value = '';
    try {
        const batch = await axios.post<{ id: number; cnt: number }>(`/api/chz/batch/upd/${doc.sfcode}`);
        await fetchFile(batch.data.id, `vyvod_UPD-${doc.nsf ?? doc.sfcode}_${fmtDay(doc.date)}.xlsx`);
        message.value =
            `Пачка №${batch.data.id} по УПД №${doc.nsf ?? doc.sfcode}: ${batch.data.cnt} КИ. ` +
            'В ГИС МТ укажи номер и дату этой УПД, затем нажми «Подтвердить» в истории.';
        await refresh();
    } catch (e: any) {
        error.value = e?.response?.data?.message ?? e?.message ?? 'Ошибка';
    } finally {
        busy.value = false;
    }
}

async function confirm(batch: BatchInfo) {
    busy.value = true;
    error.value = '';
    try {
        const res = await axios.post<{ confirmed: number; skipped: number; already: boolean }>(
            `/api/chz/batch/${batch.id}/confirm`,
        );
        message.value = res.data.already
            ? `Пачка №${batch.id} уже была подтверждена.`
            : `Пачка №${batch.id}: подтверждено ${res.data.confirmed} КИ` +
              (res.data.skipped ? `, пропущено ${res.data.skipped} (сменили состояние — попадут в другую пачку)` : '') + '.';
        await refresh();
    } catch (e: any) {
        error.value = e?.response?.data?.message ?? e?.message ?? 'Ошибка';
    } finally {
        busy.value = false;
    }
}

onMounted(refresh);
</script>

<template>
    <div>
        <v-alert v-if="error" type="error" class="mb-2" closable @click:close="error = ''">{{ error }}</v-alert>
        <v-alert v-if="message" type="info" class="mb-2" closable @click:close="message = ''">{{ message }}</v-alert>

        <v-card class="mb-4">
            <v-card-title>
                Вывести из оборота — {{ retire.length }} КИ
                <v-btn class="ml-4" color="primary" :disabled="busy || !retire.length" @click="download('retire')">
                    Скачать xlsx
                </v-btn>
                <v-btn class="ml-2" variant="text" :disabled="busy" @click="refresh">Обновить</v-btn>
            </v-card-title>
            <v-data-table :headers="headers" :items="retire" item-value="ki" density="compact" no-data-text="Передавать нечего">
                <template v-slot:item.since="{ item }">{{ fmtDate(item.since) }}</template>
            </v-data-table>
        </v-card>

        <v-card class="mb-4">
            <v-card-title>Вывести из оборота по УПД — {{ upd.length }} документов</v-card-title>
            <v-card-subtitle>
                Покупатели вне ЧЗ. В ГИС МТ вывод оформляется по документу, поэтому файл — на каждую УПД отдельно.
            </v-card-subtitle>
            <v-data-table :headers="docHeaders" :items="upd" item-value="sfcode" density="compact" no-data-text="Выводить нечего">
                <template v-slot:item.date="{ item }">{{ fmtDay(item.date) }}</template>
                <template v-slot:item.since="{ item }">{{ fmtDate(item.since) }}</template>
                <template v-slot:item.actions="{ item }">
                    <v-btn size="small" color="primary" :disabled="busy" @click="downloadDoc(item)">Скачать xlsx</v-btn>
                </template>
            </v-data-table>
        </v-card>

        <v-card class="mb-4">
            <v-card-title>
                Вернуть в оборот — {{ giveBack.length }} КИ
                <v-btn class="ml-4" color="primary" :disabled="busy || !giveBack.length" @click="download('return')">
                    Скачать xlsx
                </v-btn>
            </v-card-title>
            <v-data-table :headers="headers" :items="giveBack" item-value="ki" density="compact" no-data-text="Возвращать нечего">
                <template v-slot:item.since="{ item }">{{ fmtDate(item.since) }}</template>
            </v-data-table>
        </v-card>

        <v-card>
            <v-card-title>История пачек</v-card-title>
            <v-table density="compact">
                <thead>
                    <tr><th>№</th><th>Вид</th><th>Документ</th><th>Создана</th><th>КИ</th><th>Статус</th></tr>
                </thead>
                <tbody>
                    <tr v-for="batch in batches" :key="batch.id">
                        <td>{{ batch.id }}</td>
                        <td>{{ kindTitle(batch.kind) }}</td>
                        <td>{{ batchDoc(batch) }}</td>
                        <td>{{ fmtDate(batch.createdAt) }}</td>
                        <td>{{ batch.cnt }}</td>
                        <td>
                            <span v-if="batch.confirmedAt">подтверждена {{ fmtDate(batch.confirmedAt) }}</span>
                            <v-btn v-else size="small" color="success" :disabled="busy" @click="confirm(batch)">
                                Подтвердить
                            </v-btn>
                        </td>
                    </tr>
                    <tr v-if="!batches.length"><td colspan="6">Пачек ещё не было</td></tr>
                </tbody>
            </v-table>
        </v-card>
    </div>
</template>
