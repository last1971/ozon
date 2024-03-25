<script setup lang="ts">
    import { priceStore } from "@/stores/prices";
    import { storeToRefs } from "pinia";
    import Price from "@/components/Price.vue";
    const { prices } = storeToRefs(priceStore())

</script>

<template>
    <v-container>
        <v-card elevated v-for="(price, ind) in prices" :key="price.offer_id">
            <price :value="price" :ind="ind" class="pa-2"/>
            <v-divider :thickness="5"></v-divider>
        </v-card>
    </v-container>
</template>

<style scoped>

</style>