<script setup lang="ts">
import type { PriceDto } from '@/contracts/price.dto';
import { storeToRefs } from 'pinia';
import { priceStore } from '@/stores/prices';
import { computed, ref, watch } from 'vue';
import { debounce } from 'lodash';
import { tariffStore } from '@/stores/tariffStore';

const props = defineProps<{ value: PriceDto; ind: number }>();
const { pays, isLoadingPrice } = storeToRefs(priceStore());
const { tariffs } = storeToRefs(tariffStore());
const edit = ref(false);

const updateAvailablePrice = (newValue: string) => {
    props.value.available_price = parseFloat(newValue) || 0; // Преобразование строки в число
};

watch(
    () =>
        props.value.old_perc +
        props.value.min_perc +
        props.value.perc +
        props.value.adv_perc +
        props.value.sum_pack +
        props.value.incoming_price +
        props.value.available_price,
    debounce(async () => {
        await priceStore().getInd(props.ind);
    }, 2000),
);
const incomingPrice = computed(() => (edit.value ? props.value.available_price : props.value.incoming_price));
const profit = computed(() => {
    if (!pays.value?.[props.ind]?.[0]) return 0;
    return Math.ceil(parseInt(pays.value[props.ind][0]) - incomingPrice.value);
});
const minPerc = computed(() => {
    if (!pays.value?.[props.ind]?.[0] || !incomingPrice.value) return 0;
    return Math.ceil(((parseInt(pays.value[props.ind][0]) - incomingPrice.value) / incomingPrice.value) * 100);
});

const isSumZero = (index: number) => {
    return props.value.fbsCount + props.value.fboCount === 0;
};
</script>

<template>
    <div>
        <v-table>
            <template v-slot:bottom>
                <v-row class="d-flex align-center justify-center">
                    <v-col cols="3">
                        <v-switch class="mt-4" label="своя цена" v-model="edit" />
                    </v-col>
                    <v-col cols="3">
                        <v-btn @click="priceStore().getInd(props.ind)" block prepend-icon="mdi-reload">
                            Обновить
                        </v-btn>
                    </v-col>
                    <v-col cols="3">
                        <v-btn
                            block
                            prepend-icon="mdi-calculator"
                            @click="priceStore().calculatePercents(props.ind)"
                            :loading="isLoadingPrice[props.ind]"
                            :disabled="isSumZero(props.ind)"
                        >
                            Рассчитать проценты
                        </v-btn>
                    </v-col>
                    <v-col cols="3">
                        <v-btn
                            block
                            prepend-icon="mdi-content-save"
                            @click="priceStore().save(props.ind, edit)"
                            :loading="isLoadingPrice[props.ind]"
                        >
                            Сохранить
                        </v-btn>
                    </v-col>
                </v-row>
            </template>
            <thead>
                <tr>
                    <th>Код</th>
                    <th>Название</th>
                    <th>FBS(шт)</th>
                    <th>FBO(шт)</th>            
                    <th>На маркете</th>
                    <th>Для нас</th>
                    <th>Выплата</th>
                    <th>Вх.цена</th>
                    <th>Рын.цена</th>
                    <th>Прибыль</th>
                    <th>Рекл.</th>
                    <th>Упак</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{{ value.offer_id }}</td>
                    <td>{{ value.name }}</td>
                    <td>{{ value.fbsCount }}</td>
                    <td>{{ value.fboCount }}</td>
                    <td>{{ Math.ceil(value.marketing_price) }} ₽</td>
                    <td>{{ Math.ceil(value.marketing_seller_price) }} ₽</td>
                    <td>{{ pays[ind]?.[0] ? Math.ceil(parseInt(pays[ind][0])) : 0 }} ₽</td>
                    <td>{{ Math.ceil(value.incoming_price) }} ₽</td>
                    <td>
                        <v-text-field
                            :model-value="value.available_price"
                            @update:modelValue="updateAvailablePrice"
                            suffix="₽"
                            variant="underlined"
                        />
                    </td>
                    <td :class="{ 'bg-orange text-white': profit < tariffs.min_price || minPerc < tariffs.min_perc }">
                        {{ profit }} ₽ / {{ minPerc }} %
                    </td>
                    <td>
                        <v-text-field
                            v-model="value.adv_perc"
                            variant="underlined"
                            style="width: 50px"
                            append-inner-icon="mdi-percent"
                        ></v-text-field>
                    </td>
                    <td>
                        <v-text-field
                            v-model="value.sum_pack"
                            variant="underlined"
                            style="width: 50px"
                            append-inner-icon="mdi-currency-rub"
                        ></v-text-field>
                    </td>
                </tr>
            </tbody>
        </v-table>
        <v-divider :thickness="3" />
        <v-table>
            <thead>
                <tr>
                    <th>Тип</th>
                    <th>Процент</th>
                    <th>Цена</th>
                    <th>Выплата</th>
                    <th>Прибыль</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Макс</td>
                    <td>
                        <v-text-field
                            v-model="value.old_perc"
                            variant="underlined"
                            append-inner-icon="mdi-percent"
                        ></v-text-field>
                    </td>
                    <td>{{ Math.ceil(value.old_price) }} ₽</td>
                    <td>{{ Math.ceil(parseInt(pays[ind][1])) }} ₽</td>
                    <td>{{ Math.ceil(parseInt(pays[ind][1]) - incomingPrice) }} ₽</td>
                </tr>
                <tr>
                    <td>Норм</td>
                    <td>
                        <v-text-field
                            v-model="value.perc"
                            variant="underlined"
                            append-inner-icon="mdi-percent"
                        ></v-text-field>
                    </td>
                    <td>{{ Math.ceil(value.price) }} ₽</td>
                    <td>{{ Math.ceil(parseInt(pays[ind][2])) }} ₽</td>
                    <td>{{ Math.ceil(parseInt(pays[ind][2]) - incomingPrice) }} ₽</td>
                </tr>
                <tr>
                    <td>Мин</td>
                    <td>
                        <v-text-field
                            v-model="value.min_perc"
                            variant="underlined"
                            append-inner-icon="mdi-percent"
                        ></v-text-field>
                    </td>
                    <td>{{ Math.ceil(value.min_price) }} ₽</td>
                    <td>{{ Math.ceil(parseInt(pays[ind][3])) }} ₽</td>
                    <td>{{ Math.ceil(parseInt(pays[ind][3]) - incomingPrice) }} ₽</td>
                </tr>
            </tbody>
        </v-table>
    </div>
</template>

<style scoped></style>
