<script setup lang="ts">
import TheWelcome from '../components/TheWelcome.vue'
import Tariff from "@/components/Tariff.vue";
import Articles from "@/components/Articles.vue";
import Prices from "@/components/Prices.vue";
</script>

<template>

    <Tariff class="pa-2"/>
    <v-divider :thickness="5" />
    <Articles class="pa-2" />
    <v-divider :thickness="5" />
    <Prices class="pa-2" />
</template>
