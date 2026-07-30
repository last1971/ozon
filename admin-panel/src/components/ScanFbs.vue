<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import axios from "../axios.config";
import ProductImage from "@/components/ProductImage.vue";
import BarcodeImage from "@/components/BarcodeImage.vue";
import { GoodServiceEnum, goodStore } from "@/stores/goods";
import { find } from "lodash";
import type { GoodInfoDto } from "@/contracts/good.info.dto";
import type {
    FbsPrepareDto,
    MarkScanProgressDto,
    MarkScanProgressLineDto,
    MarkScanResultDto,
    SubmitResultDto,
} from "@/contracts/mark-scan-progress.dto";

const url = import.meta.env.VITE_URL;

const products = ref<any[]>([]);
const goods = goodStore();

const extractQuantity = (sku: string) => {
    const parts = sku.split('-'); // Разделяем строку по символу '-'
    return parts.length > 1 ? parseInt(parts[1], 10) : 1; // Если есть количество, возвращаем его, иначе 1
}

const markProgress = ref<MarkScanProgressDto | null>(null);

const linesByGoodscode = computed<Map<string, MarkScanProgressLineDto[]>>(() => {
    const map = new Map<string, MarkScanProgressLineDto[]>();
    if (!markProgress.value) return map;
    for (const line of markProgress.value.lines) {
        const arr = map.get(line.goodscode) ?? [];
        arr.push(line);
        map.set(line.goodscode, arr);
    }
    return map;
});

const lines = computed(
    () => products.value.map((a) => {
        const good: GoodInfoDto | undefined = find(goods.goodInfos.get(service.value), { sku: a.offer_id });
        const goodscode = good?.id || '';
        const progressLines = linesByGoodscode.value.get(goodscode) ?? [];
        const requiresScan = progressLines.some((l) => l.requiresScan);
        const quantityScanned = progressLines.reduce((s, l) => s + l.quantityScanned, 0);
        const quantityNeeded = progressLines.reduce((s, l) => s + l.quantityNeeded, 0);
        return {
            offer_id: a.offer_id,
            quantity: a.quantity,
            name: good?.remark || '',
            barcode: good?.barCode || '',
            image: good?.primaryImage || '',
            goodscode,
            requiresScan,
            quantityScanned,
            quantityNeeded,
            isComplete: !requiresScan || quantityScanned >= quantityNeeded,
        }
    }),
);

// Маркетплейс берём из ответа бэка (order.service), а не по хардкод-buyerId.
// Разные инстансы = разные id, поэтому источник истины — бэк.
const orderService = ref<GoodServiceEnum | null>(null);
const service = computed<GoodServiceEnum>(() => orderService.value ?? GoodServiceEnum.OZON);
const isOzon = computed(() => service.value === GoodServiceEnum.OZON);

const headers = ref([
    { title: 'Картинка', key: 'image', sortable: false },     // Колонка с картинкой товара
    { title: 'Штрихкод', key: 'barcode', sortable: false },   // Колонка с картинкой штрихкода
    { title: 'Название', key: 'name' },                       // Название товара
    { title: 'Количество', key: 'quantity' },
    { title: 'КМ', key: 'mark', sortable: false },
]);

// Переменные для полей ввода и времени
const firstInput = ref<string>('');
const secondInput = ref<string>('');
const markScanInput = ref<string>('');
const invoice = ref<any>(null);

const snackbar = ref(false); // Переменная для показа snackbar
const snackbarMessage = ref(''); // Сообщение для показа
const snackbarColor = ref<string>('success');
const snackbarTimeout =  ref<number>(5000);

// Переменные для состояния задизабленности полей
const firstDisabled = ref<boolean>(false);
const secondDisabled = ref<boolean>(true);
const markScanDisabled = ref<boolean>(true);
const submitInProgress = ref<boolean>(false);

// OZON: последовательные шаги «Подобрано» → «Передать/Проверить» → скан ШК.
const pickInProgress = ref<boolean>(false);
const pickDone = ref<boolean>(false);
const transferInProgress = ref<boolean>(false);
const transferDone = ref<boolean>(false);
const confirmTransfer = ref<boolean>(false); // диалог «точно передать?»

// Переменные для времени
const firstTime = ref<string>('');
const secondTime = ref<string>('');

// Refs для фокусировки
const firstInputRef = ref<any>(null);
const secondInputRef = ref<any>(null);
const markScanInputRef = ref<any>(null);

const isReadyToFinish = computed(() => markProgress.value?.isReadyToFinish ?? true);
const requiresMarkScan = computed(() =>
    !!markProgress.value && markProgress.value.lines.some((l) => l.requiresScan),
);
// «Передать коды» (ВБ) доступно, когда сборка начата и все КМ отсканированы (или их нет).
const canSubmitMarks = computed(
    () => firstDisabled.value && isReadyToFinish.value && !submitInProgress.value,
);
// КМ-шаг закрыт: заказ загружен и все КМ отсканированы (или не требуются).
const kmReady = computed(() => firstDisabled.value && isReadyToFinish.value);
// OZON «Подобрано» — после закрытия КМ-шага, до подбора.
const canPick = computed(
    () => isOzon.value && kmReady.value && !pickDone.value && !pickInProgress.value,
);
// OZON «Передать/Проверить» — после подбора, до успешной передачи.
const canTransfer = computed(
    () => isOzon.value && pickDone.value && !transferDone.value && !transferInProgress.value,
);
const lastAttachedKi = computed(() => {
    const kis = markProgress.value?.attachedKis ?? [];
    return kis.length ? kis[kis.length - 1] : '';
});
// Счёт подобран (STATUS=4) → отвязка КМ запрещена (бэк тоже отклонит).
const isPickedUp = computed(() => markProgress.value?.isPickedUp ?? false);

function showSnackbar(message: string, color: string, timeout = 5000) {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbarTimeout.value = timeout;
    snackbar.value = true;
}

async function update(remark: string, data: any, text: string): Promise<{ ok: boolean; submit?: SubmitResultDto }> {
    let ok = true;
    let submit: SubmitResultDto | undefined;
    snackbarTimeout.value = 5000;
    try {
        const res = await axios.put(`/api/pickup/${remark}`, data);
        invoice.value = res.data.invoice;
        submit = res.data.submit;
        const order = await axios.get(`/api/order/${invoice.value.buyerId}/${remark}`);
            //axios.get(`/api/order/${remark}`);
        if (!order.data?.products) {
            const error = new Error('Products not found in order') as Error & { status: number };
            error.status = 400; // Добавляем свойство `status`
            // noinspection ExceptionCaughtLocallyJS
            throw error;
        }
        // Маркетплейс — из бэка (ветка ВБ/OZON), а не по buyerId.
        orderService.value = (order.data.service as GoodServiceEnum) ?? null;
        snackbarMessage.value = text;
        snackbarColor.value = 'success';
        products.value = order.data.products;
        await goods.getGoodInfoBySkus(products.value.map((v) => v.offer_id ), service.value)
    } catch (e: any) {
        products.value = [];
        const status = e.status ?? e.response?.status;
        if (status === 400) {
            // Может быть «нет заказа» ИЛИ сверка IGK≠ШК (OZON) — показываем сообщение сервера.
            const msg = e.response?.data?.message;
            snackbarMessage.value = (Array.isArray(msg) ? msg.join(', ') : msg) || 'Такого заказа нет в базе данных';
            snackbarColor.value = 'warning';
        } else {
            snackbarTimeout.value = 60000;
            const msg = e.response?.data?.message;
            snackbarMessage.value =
               `Система не работает, сообщить ВВ, код: ${status}, ошибка: ${Array.isArray(msg) ? msg.join(', ') : (msg ?? e.message)}`;
            snackbarColor.value = 'error';
        }
        ok = false;
    }
    snackbar.value = true;
    return { ok, submit };
}

async function loadMarkProgress(remark: string): Promise<boolean> {
    try {
        const res = await axios.get<MarkScanProgressDto>(`/api/invoice/${remark}/markcode/progress`);
        markProgress.value = res.data;
        return true;
    } catch (e: any) {
        markProgress.value = null;
        showSnackbar(`Не удалось получить прогресс КМ: ${e?.response?.data?.message ?? e.message}`, 'error', 60000);
        return false;
    }
}

// Функция для получения текущего времени
function getCurrentTime(): string {
    const date = new Date();

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Месяцы начинаются с 0, поэтому +1
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // Возвращаем строку в формате YYYY-MM-DD HH:MM:SS
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Функция для обработки ввода в первое поле
async function onFirstInput() {
    if (firstInput.value) {
        firstDisabled.value = true;
        firstTime.value = getCurrentTime();
        const res = await update(
            firstInput.value,
            { START_PICKUP: firstTime.value },
            'Сборка начата'
        );
        if (res.ok) {
            const progressOk = await loadMarkProgress(firstInput.value);
            if (progressOk && requiresMarkScan.value && !isReadyToFinish.value) {
                markScanDisabled.value = false;
                secondDisabled.value = true;
                await setFocus(markScanInputRef);
            } else {
                // КМ не нужны / уже готово. ВБ → сразу поле ШК. OZON → ждём «Подобрано».
                markScanDisabled.value = true;
                secondDisabled.value = isOzon.value;
                if (!isOzon.value) await setFocus(secondInputRef);
            }
        } else {
            firstDisabled.value = false;
            await setFocus(firstInputRef);
        }
    }
}

async function onMarkScanInput() {
    const raw = markScanInput.value.trim();
    if (!raw) return;
    try {
        const res = await axios.post<MarkScanResultDto>(
            `/api/invoice/${firstInput.value}/markcode`,
            { ki: raw },
        );
        markProgress.value = res.data.progress;
        markScanInput.value = '';
        showSnackbar(`КМ привязан (${res.data.attached.ki.slice(0, 18)}…)`, 'success');
        if (markProgress.value.isReadyToFinish) {
            // Все КМ отсканированы. ВБ → поле ШК. OZON → ждём «Подобрано».
            markScanDisabled.value = true;
            secondDisabled.value = isOzon.value;
            if (!isOzon.value) await setFocus(secondInputRef);
        } else {
            await setFocus(markScanInputRef);
        }
    } catch (e: any) {
        markScanInput.value = '';
        const status = e?.response?.status;
        const message = e?.response?.data?.message ?? e.message;
        const color = status === 404 || status === 409 ? 'warning' : 'error';
        showSnackbar(`КМ не привязан: ${message}`, color, status === 404 || status === 409 ? 5000 : 60000);
        await setFocus(markScanInputRef);
    }
}

async function onUnscanLast() {
    const ki = lastAttachedKi.value;
    if (!ki) return;
    try {
        const res = await axios.delete<MarkScanProgressDto>(
            `/api/invoice/${firstInput.value}/markcode/${encodeURIComponent(ki)}`,
        );
        markProgress.value = res.data;
        showSnackbar('Последний КМ отвязан', 'success');
        if (!markProgress.value.isReadyToFinish) {
            markScanDisabled.value = false;
            secondDisabled.value = true;
            await setFocus(markScanInputRef);
        }
    } catch (e: any) {
        const message = e?.response?.data?.message ?? e.message;
        showSnackbar(`Не удалось отвязать КМ: ${message}`, 'error', 10000);
    }
}

// Кнопка «Передать коды»: отдельная задача — передать КМ (+ГТД) маркетплейсу. Без сборки.
async function onSubmitMarks() {
    if (!canSubmitMarks.value) return;
    submitInProgress.value = true;
    try {
        const res = await axios.post(`/api/pickup/${firstInput.value}/marks`);
        const submit: SubmitResultDto | undefined = res.data?.submit;
        if (submit?.ok === true) {
            showSnackbar('КМ переданы маркетплейсу', 'success');
        } else if (submit?.ok === false) {
            const reason = (submit.failed ?? []).map((f) => f.reason).join('; ');
            showSnackbar(`КМ не переданы: ${reason || 'ошибка'}`, 'error', 60000);
        } else {
            // undefined → маркировка выключена / товар немаркируемый — передавать нечего
            showSnackbar('Передача КМ не требуется', 'success');
        }
    } catch (e: any) {
        const message = e?.response?.data?.message ?? e.message;
        showSnackbar(`Ошибка передачи КМ: ${message}`, 'error', 60000);
    } finally {
        submitInProgress.value = false;
    }
}

// OZON «Подобрано» — подбор счёта (как крон, идемпотентно). Ошибка → стоп.
async function onPick() {
    if (!canPick.value) return;
    pickInProgress.value = true;
    try {
        await axios.post(`/api/pickup/${firstInput.value}/pick`);
        pickDone.value = true;
        showSnackbar('Счёт подобран — можно передавать', 'success');
    } catch (e: any) {
        const message = e?.response?.data?.message ?? e.message;
        showSnackbar(`Подбор не выполнен: ${message}`, 'error', 60000);
    } finally {
        pickInProgress.value = false;
    }
}

// OZON «Передать/Проверить» — фаза 1: create-or-get (предпроверка) → диалог «точно передать?».
async function onTransferClick() {
    if (!canTransfer.value) return;
    transferInProgress.value = true;
    let prepare: FbsPrepareDto | undefined;
    try {
        const res = await axios.post(`/api/pickup/${firstInput.value}/marks/prepare`);
        prepare = res.data?.prepare;
    } catch (e: any) {
        const message = e?.response?.data?.message ?? e.message;
        showSnackbar(`Предпроверка не прошла: ${message}`, 'error', 60000);
        transferInProgress.value = false;
        return;
    }
    transferInProgress.value = false;
    if (prepare && prepare.ok === false) {
        showSnackbar(`Предпроверка: ${prepare.error ?? 'ошибка'}`, 'error', 60000);
        return;
    }
    confirmTransfer.value = true;
}

// OZON подтверждение передачи: фаза 2 — цепочка (validate→set→status→ship→label).
// Окно этикетки открываем СИНХРОННО в обработчике клика (обход попап-блока), URL ставим после успеха.
async function onTransferConfirm() {
    confirmTransfer.value = false;
    const labelWindow = window.open('', '_blank');
    transferInProgress.value = true;
    try {
        const res = await axios.post(`/api/pickup/${firstInput.value}/marks`);
        const submit: SubmitResultDto | undefined = res.data?.submit;
        if (submit?.ok === true) {
            if (labelWindow) labelWindow.location.href = `${url}/api/pickup/${firstInput.value}/label`;
            transferDone.value = true;
            secondDisabled.value = false;
            showSnackbar('Передано. Печатайте этикетку и сканируйте ШК посылки', 'success');
            await setFocus(secondInputRef);
        } else {
            if (labelWindow) labelWindow.close();
            const reason = (submit?.failed ?? []).map((f) => f.reason).join('; ');
            const prefix = submit?.goToOzon
                ? 'Ошибка после отправки — разберитесь в ЛК Озона: '
                : 'Не передано: ';
            showSnackbar(prefix + (reason || submit?.failedStep || 'ошибка'), 'error', 60000);
        }
    } catch (e: any) {
        if (labelWindow) labelWindow.close();
        const message = e?.response?.data?.message ?? e.message;
        showSnackbar(`Ошибка передачи: ${message}`, 'error', 60000);
    } finally {
        transferInProgress.value = false;
    }
}

// Скан ШК посылки — фиксируем IGK и переходим к новой сборке.
// OZON: бэк сверяет IGK==ШК (несовпадение → 400). ВБ: сверки нет, просто фиксация.
async function onSecondInput() {
    if (secondInput.value) {
        secondDisabled.value = true;
        secondTime.value = getCurrentTime();
        const res = await update(
            firstInput.value,
            { FINISH_PICKUP: secondTime.value, IGK: secondInput.value },
            'Сборка завершена'
        );
        if (res.ok) {
            await resetFields();
        } else {
            secondDisabled.value = false;
        }
    }
}

// Функция для разблокировки первого поля
async function unlockFirstInput() {
    if (firstDisabled.value) {
        firstDisabled.value = false;
        firstInput.value = '';
        firstTime.value = '';
        // Сбрасываем OZON-шаги — начинаем заказ заново.
        pickDone.value = false;
        pickInProgress.value = false;
        transferDone.value = false;
        transferInProgress.value = false;
        confirmTransfer.value = false;
        markScanDisabled.value = true;
        secondDisabled.value = true;
        orderService.value = null;
        markProgress.value = null;
        products.value = [];
        await setFocus(firstInputRef);
    }
}

// Функция для разблокировки второго поля
async function unlockSecondInput() {
    if (secondDisabled.value) {
        secondDisabled.value = false;
        secondInput.value = '';
        secondTime.value = '';
        await setFocus(secondInputRef);
    }
}

// Функция для сброса всех полей
async function resetFields() {
    firstInput.value = '';
    secondInput.value = '';
    markScanInput.value = '';
    firstDisabled.value = false;
    secondDisabled.value = true;
    markScanDisabled.value = true;
    submitInProgress.value = false;
    pickInProgress.value = false;
    pickDone.value = false;
    transferInProgress.value = false;
    transferDone.value = false;
    confirmTransfer.value = false;
    orderService.value = null;
    firstTime.value = '';
    secondTime.value = '';
    products.value = [];
    markProgress.value = null;
    await setFocus(firstInputRef);
}

async function setFocus(ref: any) {
    await nextTick();
    // Переводим фокус на первое поле
    if (ref.value?.$el) {
        const inputElement: HTMLInputElement = ref.value.$el.querySelector('input');
        if (inputElement) inputElement.focus();
    }
}

// Приход номера заказа из грида «OZON FBS этикетки» — грузим тем же onFirstInput (без дублей).
const props = defineProps<{ prefill?: string }>();
watch(() => props.prefill, async (order) => {
    if (!order) return;
    await resetFields();
    firstInput.value = order;
    await onFirstInput();
});
</script>

<template>
    <v-container>
        <v-row align="center">
            <!-- Первое текстовое поле ввода -->
            <v-col cols="2">
                <v-text-field
                    v-model="firstInput"
                    label="Введите номер заказа"
                    :disabled="firstDisabled"
                    @input="onFirstInput"
                    outlined
                    ref="firstInputRef"
                    focused
                ></v-text-field>
            </v-col>

            <!-- Кнопка разблокировки первого поля -->
            <v-col cols="auto">
                <v-btn
                    icon
                    @click="unlockFirstInput"
                    :disabled="!firstDisabled"
                    class="mb-4"
                >
                    <v-icon>mdi-lock-open</v-icon>
                </v-btn>
            </v-col>

            <!-- Задизабленное поле с временем -->
            <v-col cols="2">
                <v-text-field
                    v-model="firstTime"
                    label="Время начала сборки"
                    :disabled="true"
                ></v-text-field>
            </v-col>

            <!-- Поле сканирования КМ -->
            <v-col cols="3">
                <v-text-field
                    v-model="markScanInput"
                    label="Сканируйте КМ (Честный Знак)"
                    :disabled="markScanDisabled"
                    @keyup.enter="onMarkScanInput"
                    outlined
                    ref="markScanInputRef"
                ></v-text-field>
            </v-col>

            <!-- Кнопка отвязки последнего КМ -->
            <v-col cols="auto">
                <v-btn
                    @click="onUnscanLast"
                    :disabled="!lastAttachedKi || isPickedUp"
                    class="mb-4"
                    color="warning"
                    variant="outlined"
                    size="small"
                >
                    Отвязать последний
                </v-btn>
            </v-col>

            <!-- ВБ: передача КМ (+ГТД) маркетплейсу -->
            <v-col cols="2" v-if="!isOzon">
                <v-btn
                    block
                    color="primary"
                    class="mb-4"
                    :disabled="!canSubmitMarks"
                    :loading="submitInProgress"
                    @click="onSubmitMarks"
                >
                    Передать коды
                </v-btn>
            </v-col>

            <!-- OZON: подбор счёта -->
            <v-col cols="2" v-if="isOzon">
                <v-btn
                    block
                    color="secondary"
                    class="mb-4"
                    :disabled="!canPick"
                    :loading="pickInProgress"
                    @click="onPick"
                >
                    Подобрано
                </v-btn>
            </v-col>

            <!-- OZON: передача + этикетка -->
            <v-col cols="2" v-if="isOzon">
                <v-btn
                    block
                    color="primary"
                    class="mb-4"
                    :disabled="!canTransfer"
                    :loading="transferInProgress"
                    @click="onTransferClick"
                >
                    Передать / Проверить
                </v-btn>
            </v-col>

            <!-- Второе текстовое поле ввода -->
            <v-col cols="2">
                <v-text-field
                    v-model="secondInput"
                    label="Введите штрих код"
                    :disabled="secondDisabled"
                    @keyup.enter="onSecondInput"
                    outlined
                    ref="secondInputRef"
                ></v-text-field>
            </v-col>

            <!-- Кнопка разблокировки второго поля -->
            <v-col cols="auto">
                <v-btn
                    icon
                    @click="unlockSecondInput"
                    :disabled="!secondDisabled"
                    class="mb-4"
                >
                    <v-icon>mdi-lock-open</v-icon>
                </v-btn>
            </v-col>

            <!-- Задизабленное поле с временем окончания -->
            <v-col cols="2">
                <v-text-field
                    v-model="secondTime"
                    label="Время окончания сборки"
                    :disabled="true"
                ></v-text-field>
            </v-col>

            <!-- Кнопка сброса всех данных -->
            <v-col cols="2">
                <v-btn block class="mb-4" @click="resetFields">Новый ввод</v-btn>
            </v-col>
        </v-row>

        <v-data-table
            :headers="headers"
            :items="lines"
            class="w-100"
            hide-default-footer
        >
            <!-- Слот для отображения изображения товара -->
            <template #item.image="{ item }">
                <product-image :image="item.image" :alt="item.name" />
            </template>

            <!-- Слот для отображения изображения штрихкода -->
            <template #item.barcode="{ item }">
                <barcode-image barcode-type="code128" :url="url" :barcode="item.barcode" />
            </template>

            <template #item.name="{ item }">
                <v-row>
                    {{ item.name }}
                </v-row>
                <v-row>
                    <v-col>
                        {{ item.offer_id }}
                    </v-col>
                    <v-col>
                        *
                    </v-col>
                    <v-col>
                        {{ item.quantity }}
                    </v-col>
                </v-row>
            </template>

            <template #item.quantity="{ item }">
                <div
                    style="
            font-weight: bold;
            font-size: 2rem;
            text-align: center;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;"
                >
                    {{ extractQuantity(item.offer_id) * item.quantity }}
                </div>
            </template>

            <template #item.mark="{ item }">
                <div
                    v-if="item.requiresScan"
                    :style="{
                        fontWeight: 'bold',
                        fontSize: '1.25rem',
                        textAlign: 'center',
                        color: item.isComplete ? '#229A16' : '#B72136',
                    }"
                >
                    {{ item.quantityScanned }}/{{ item.quantityNeeded }}
                </div>
                <div v-else style="text-align: center; color: #919EAB;">—</div>
            </template>

        </v-data-table>

        <!-- OZON: подтверждение передачи перед set -->
        <v-dialog v-model="confirmTransfer" max-width="420" persistent>
            <v-card>
                <v-card-title>Передать в Озон?</v-card-title>
                <v-card-text>
                    Коды и ГТД будут отправлены, отправление отгружено. После этого откроется этикетка —
                    распечатайте и отсканируйте ШК посылки.
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="confirmTransfer = false">Отмена</v-btn>
                    <v-btn color="primary" variant="flat" @click="onTransferConfirm">Передать</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-snackbar
            v-model="snackbar"
            :timeout="snackbarTimeout"
            :color="snackbarColor"
            location="center"
        >
            {{ snackbarMessage }}
            <template v-slot:actions>
                <v-btn icon small @click="snackbar = false" style="color: white;">
                    <v-icon small>mdi-close</v-icon>
                </v-btn>
            </template>
        </v-snackbar>
    </v-container>
</template>

<style scoped>

</style>
