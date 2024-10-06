<script setup lang="ts">
import { ref } from "vue";
import axios from "../axios.config";


// Переменные для полей ввода и времени
const firstInput = ref<string>('');
const secondInput = ref<string>('');

const snackbar = ref(false); // Переменная для показа snackbar
const snackbarMessage = ref(''); // Сообщение для показа
const snackbarColor = ref<string>('success');
const snackbarTimeout =  ref<number>(5000);

// Переменные для состояния задизабленности полей
const firstDisabled = ref<boolean>(false);
const secondDisabled = ref<boolean>(true);

// Переменные для времени
const firstTime = ref<string>('');
const secondTime = ref<string>('');

async function update(remark, data, text: string): Promise<boolean> {
    let result = true;
    try {
        await axios.put(`/api/invoice/update/${remark}`, data);
        snackbarMessage.value = text;
        snackbarColor.value = 'success';
    } catch (e) {
       if (e.status === 400) {
           snackbarMessage.value = 'Такого заказа нет в базе данных';
           snackbarColor.value = 'warning';
       } else {
           snackbarMessage.value = 'Система не работает, сообщить ВВ'
           snackbarColor.value = 'error';
       }
        result = false;
    }
    snackbar.value = true;
    return result;
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
        if (res) {
            secondDisabled.value = false;
        } else {
            firstDisabled.value = false;
        }
    }
}

// Функция для обработки ввода во второе поле
async function onSecondInput() {
    if (secondInput.value) {
        secondDisabled.value = true;
        secondTime.value = getCurrentTime();
        await update(
            firstInput.value,
            { FINISH_PICKUP: secondTime.value, IGK: secondInput.value },
            'Сборка завершена'
        );
    }
}

// Функция для разблокировки первого поля
function unlockFirstInput() {
    if (firstDisabled.value) {
        firstDisabled.value = false;
        firstInput.value = '';
        firstTime.value = '';
    }
}

// Функция для разблокировки второго поля
function unlockSecondInput() {
    if (secondDisabled.value) {
        secondDisabled.value = false;
        secondInput.value = '';
        secondTime.value = '';
    }
}

// Функция для сброса всех полей
function resetFields() {
    firstInput.value = '';
    secondInput.value = '';
    firstDisabled.value = false;
    secondDisabled.value = true;
    firstTime.value = '';
    secondTime.value = '';
}
</script>

<template>
    <v-container>
        <!-- Первое текстовое поле ввода -->
        <div style="display: flex; align-items: center;">
            <!-- Поле ввода -->
            <v-text-field
                v-model="firstInput"
                label="Введите номер заказа"
                :disabled="firstDisabled"
                @input="onFirstInput"
                outlined
                dense
                style="flex: 1;"
            ></v-text-field>

            <!-- Кнопка рядом с полем ввода -->
            <v-btn
                icon
                @click="unlockFirstInput"
                class="clickable"
                :disabled="!firstDisabled"
                style="margin-left: 10px; margin-top: -20px;"
            >
                <v-icon>mdi-lock-open</v-icon>
            </v-btn>
        </div>

        <!-- Первое задизабленное поле с временем -->
        <v-text-field
            v-model="firstTime"
            label="Время начала сборки"
            :disabled="true"
        ></v-text-field>

        <!-- Второе текстовое поле ввода -->
        <div style="display: flex; align-items: center;">
            <v-text-field
                v-model="secondInput"
                label="Введите штрих код"
                :disabled="secondDisabled"
                @keyup.enter="onSecondInput"
                outlined
                dense
                style="flex: 1;"
            ></v-text-field>
            <!-- Кнопка рядом с полем ввода -->
            <v-btn
                icon
                @click="unlockSecondInput"
                class="clickable"
                :disabled="!secondDisabled"
                style="margin-left: 10px; margin-top: -20px;"
            >
                <v-icon>mdi-lock-open</v-icon>
            </v-btn>
        </div>
        <!-- Второе задизабленное поле с временем -->
        <v-text-field
            v-model="secondTime"
            label="Время окончания сборки"
            :disabled="true"
        ></v-text-field>

        <!-- Кнопка для сброса всех данных -->
        <v-btn @click="resetFields">Новый ввод</v-btn>
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
.clickable {
    cursor: pointer;
}
</style>