<template>
  <main>
    <div class="grid grid-pre">
      <div class=" g-h "></div>
    </div>

    <div class="grid grid-pri">
        <div class="g-ce g-h g-co1">Код Озон</div>
        <div class="g-ce g-h g-co2">Наш код</div>
        <div class="g-ce g-h g-co3">Наименование</div>
        <div class="g-ce g-h g-co4">Цена покупателю</div>
        <div class="g-ce g-h g-co5">Цена расч</div>
        <div class="g-ce g-h g-co6">Выплата</div>
        <div class="g-ce g-h g-co7">Вх.цена</div>
        <div class="g-ce g-h g-co8">Max</div>
        <div class="g-ce g-h g-co9">Норм</div>
        <div class="g-ce g-h g-co10">Мин</div>
        <div class="g-ce g-h g-co11">Комис</div>
        <div class="g-ce g-h g-co12">Логист</div>
        <div class="g-ce g-h g-co13">Реклама</div>
        <div class="g-ce g-h g-co14">#</div>

      <template v-for="(item, ind) in dataSource.dmPrice?.data" :key="item.data.product_id">
        <div class="g-ce g-co1" title="Код Озон">{{item.data.product_id}}</div>
        <div class="g-ce g-co2" title="Наш код">{{item.data.offer_id}}</div>
        <div class="g-ce g-co3" title="Наименование">{{item.data.name}}</div>
        <div class="g-ce g-co4" title="Цена покупателю">{{rounding(item.data.marketing_price)}}</div>
        <div class="g-ce g-co5" title="Цена расч">{{rounding(item.data.marketing_seller_price)}}</div>
        <div class="g-ce g-co6" title="Выплата">
          <div title="тек" :class="{calc: true, chan: item.currentPaymentChanged.value}">{{rounding(item.currentPayment.value)}}</div>
          <div title="расч">{{rounding(item.calculatedPayment.value)}}</div>
        </div>
        <div class="g-ce g-co7" title="Вх.цена">{{rounding(item.data.incoming_price)}}</div>
        <div class="g-ce g-co8" title="Max">
          <div title="тек цена">{{rounding(item.data.old_price)}}</div>
          <div title="расч цена">{{rounding(item.maxCalculated.value)}}</div>
          <div title="процент">
            <input type="number" size="5" v-model="item.e_old_perc.value">
          </div>
        </div>
        <div class="g-ce g-co9" title="Норм">
          <div title="тек цена">{{rounding(item.data.price)}}</div>
          <div title="расч цена">{{rounding(item.normCalculated.value)}}</div>
          <div title="процент">
            <input type="number" v-model="item.e_perc.value">
          </div>
        </div>
        <div class="g-ce g-co10" title="Мин">
          <div title="тек цена">{{rounding(item.data.min_price)}}</div>
          <div title="расч цена">{{rounding(item.minCalculated.value)}}</div>
          <div title="процент">
            <input type="number" v-model="item.e_min_perc.value">
          </div>
        </div>
        <div class="g-ce g-co11" title="Комис">
          <div title="тек сум">calc</div>
          <div title="рас сум">calc</div>
          <div title="процент">{{item.data.sales_percent}}</div>
        </div>
        <div class="g-ce g-co12" title="Логист">
          <div title=""></div>
          <div title="сумма">{{item.data.fbs_direct_flow_trans_max_amount}}</div>
          <div title=""></div>
        </div>
        <div class="g-ce g-co13" title="Реклама">
          <div title="тек">calc</div>
          <div title="расч">calc</div>
          <div title="процент">
            <input type="number" v-model="item.e_adv_perc.value">
          </div>
        </div>
        <div class="g-ce g-co14" title="#">
          {{ind+1}}
        </div>
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
if (!dataSource.dmPrice?.data && !dataSource.dmPrice?.isLoading) dataSource.dmPrice?.getData();
const rounding = (val: number) => {
  return Math.ceil(val);
};
</script>

<style scoped lang="scss">
.grid-pre {
  
}
.grid-pri {
  max-width: 100%;
  overflow-x: scroll;
  grid-template-columns: repeat(14, 1fr);
  input {
    font-size: 20px;
    max-width: 75px;
    padding: 5px;
  }
  .calc {
    background-color: var(--calculated-background);
    padding: 3px 5px;
    border-radius: 5px;
  }
  .chan {
    border: solid 1px var(--changed-border-color);
  }
}



</style>
