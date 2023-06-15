<template>
  <main>
    <div class="grid grid-pre">
      <div class=" g-h "></div>
    </div>

    <div class="grid grid-pri">
        <div class="g-c g-h g-r1">Код Озон</div>
        <div class="g-c g-h g-r2">Наш код</div>
        <div class="g-c g-h g-r3">Наименование</div>
        <div class="g-c g-h g-r4">Цена покупателю</div>
        <div class="g-c g-h g-r5">Цена расч</div>
        <div class="g-c g-h g-r6">Выплата</div>
        <div class="g-c g-h g-r7">Вх.цена</div>
        <div class="g-c g-h g-r8">Max</div>
        <div class="g-c g-h g-r9">Норм</div>
        <div class="g-c g-h g-r10">Мин</div>
        <div class="g-c g-h g-r11">Комис</div>
        <div class="g-c g-h g-r12">Логист</div>
        <div class="g-c g-h g-r13">Реклама</div>
        <div class="g-c g-h g-r14">#</div>
      <template v-for="(item, ind) in dataSource.dmPrice?.data" :key="item.product_id">
        <GridPriLine :item="item" :ind="ind" />
      </template>
    </div>

    <div v-if="dataSource.dmPrice?.isLoading.value">загружается...</div>

    <button @click="dataSource.dmPrice?.getNext()" type="button">
      <template v-if="(dataSource.dmPrice?.data?.length ?? 0) === 0">Показать</template>
      <template v-else>Показать еще</template>
    </button>
  </main>
</template>

<script setup lang="ts">
import { dataSource } from "@/data/data";
import GridPriLine from "@/components/gridPriLine.vue";
if (!dataSource.dmPrice?.data && !dataSource.dmPrice?.isLoading) dataSource.dmPrice?.getData();
</script>

<style scoped lang="scss">
.grid-pre {
  
}
.grid-pri {
  max-width: 100%;
  overflow-x: scroll;
  grid-template-columns: repeat(14, 1fr);
}



</style>
