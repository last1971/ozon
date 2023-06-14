<template>
  <main >
    <div>DATA: {{dataSource.dmVisibility}}</div>
    <div>DEV: {{dataSource.dev}}</div>
  </main>
</template>

<script setup lang="ts">
import { dataSource } from "@/data/data";
const props = defineProps({
  changes: {
    type: Object,
    required: true,
  },
});
</script>

<style scoped lang="scss">

</style>