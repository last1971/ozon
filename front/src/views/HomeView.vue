<template>
  <main >
    <div>Visibility: {{dataSource.dmVisibility?.data}}</div>
    <div>PricePreset: {{dataSource.dmPricePreset?.data}}</div>
  </main>
</template>

<script setup lang="ts">
import { dataSource } from "@/data/data";

</script>

<style scoped lang="scss">

</style>