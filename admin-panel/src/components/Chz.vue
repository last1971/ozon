<script setup lang="ts">
import { onMounted, ref } from "vue";
import axios from "../axios.config";

// Вкладка «ЧЗ»: передача кодов маркировки в ГИС МТ.
// Точка правды — бэк (/api/chz/*): здесь только отображение и три действия —
// скачать пачку, подтвердить пачку, обновить списки.

interface PendingCode {
    ki: string;
    goodsCode: string;
    price: number | null;
    invoiceNumber: number | null;
    posting: string | null;
    since: string | null;
}

interface BatchInfo {
    id: number;
    kind: 'retire' | 'return';
    createdAt: string;
    confirmedAt: string | null;
    cnt: number;
}

const retire = ref<PendingCode[]>([]);
const giveBack = ref<PendingCode[]>([]);
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

const kindTitle = (kind: BatchInfo['kind']) => (kind === 'retire' ? 'вывод из оборота' : 'возврат в оборот');
const fmtDate = (value: string | null) => (value ? new Date(value).toLocaleString('ru-RU') : '');

async function refresh() {
    error.value = '';
    try {
        const pending = await axios.get<{ retire: PendingCode[]; giveBack: PendingCode[] }>('/api/chz/pending');
        retire.value = pending.data.retire;
        giveBack.value = pending.data.giveBack;
        const history = await axios.get<BatchInfo[]>('/api/chz/batches');
        batches.value = history.data;
    } catch (e: any) {
        error.value = e?.response?.data?.message ?? e?.message ?? 'Ошибка загрузки';
    }
}

// «Скачать» = зафиксировать пачку из текущего списка и получить её файл.
// Подтверждается потом ровно эта пачка — из истории, даже после перезагрузки страницы.
async function download(kind: BatchInfo['kind']) {
    busy.value = true;
    error.value = '';
    try {
        const batch = await axios.post<{ id: number; cnt: number }>(`/api/chz/batch/${kind}`);
        const file = await axios.get(`/api/chz/batch/${batch.data.id}/file`, { responseType: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([file.data]));
        link.download = `${kind === 'retire' ? 'vyvod_iz_oborota' : 'vozvrat_v_oborot'}_${batch.data.id}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
        message.value = `Пачка №${batch.data.id}: ${batch.data.cnt} КИ. Выгрузи файл в ГИС МТ и нажми «Подтвердить» в истории.`;
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
                    <tr><th>№</th><th>Вид</th><th>Создана</th><th>КИ</th><th>Статус</th></tr>
                </thead>
                <tbody>
                    <tr v-for="batch in batches" :key="batch.id">
                        <td>{{ batch.id }}</td>
                        <td>{{ kindTitle(batch.kind) }}</td>
                        <td>{{ fmtDate(batch.createdAt) }}</td>
                        <td>{{ batch.cnt }}</td>
                        <td>
                            <span v-if="batch.confirmedAt">подтверждена {{ fmtDate(batch.confirmedAt) }}</span>
                            <v-btn v-else size="small" color="success" :disabled="busy" @click="confirm(batch)">
                                Подтвердить
                            </v-btn>
                        </td>
                    </tr>
                    <tr v-if="!batches.length"><td colspan="5">Пачек ещё не было</td></tr>
                </tbody>
            </v-table>
        </v-card>
    </div>
</template>
