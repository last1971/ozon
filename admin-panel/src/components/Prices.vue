<script setup lang="ts">
    import { priceStore } from "@/stores/prices";
    import { storeToRefs } from "pinia";
    import Price from "@/components/Price.vue";
    import SuccessSnacbar from "@/components/SuccessSnacbar.vue";
    import FailSnackbar from "@/components/FailSnackbar.vue";

    const { prices, successSave, failSave, failMessage } = storeToRefs(priceStore())
    function successSaveFunction() {
        successSave.value = false;
    }
    function failSaveFunction() {
        failSave.value = false;
    }
</script>

<template>
    <v-container>
        <v-card elevated v-for="(price, ind) in prices" :key="price.offer_id">
            <price :value="price" :ind="ind" class="pa-2"/>
            <v-divider :thickness="5"></v-divider>
        </v-card>
        <success-snacbar :is-open="successSave" message="Цены обновлены" @close="successSaveFunction" />
        <fail-snackbar :is-open="failSave" :message="failMessage" @close="failSaveFunction" />
    </v-container>
</template>

<style scoped>

</style>