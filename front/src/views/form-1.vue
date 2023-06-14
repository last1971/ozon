<template>
  <main>
    <div>Price: {{ dataSource.dmPrice?.data}}</div>

    <div v-if="dataSource.dmPrice?.isLoading.value">загружается...</div>

    <button @click="dataSource.dmPrice?.getNext()" type="button">Дальше</button>
  </main>
</template>

<script setup lang="ts">
import { dataSource } from "@/data/data";
if (!dataSource.dmPrice?.data && !dataSource.dmPrice?.isLoading) dataSource.dmPrice?.getData();
</script>

<style scoped lang="scss">

</style>
