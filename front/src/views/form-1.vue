<template>
  <main>
    <div class="grid grid-pre">
      <div class="g-ce g-h g-co1">Max</div>
      <div class="g-ce g-h g-co2">Норм</div>
      <div class="g-ce g-h g-co3">Мин</div>
      <div class="g-ce g-h g-co4">Эквайр</div>
      <div class="g-ce g-h g-co5">Миля</div>
      <div class="g-ce g-h g-co6">Обработка</div>
      <div class="g-ce g-h g-co7">Упак</div>

      <div class="g-ce g-co1">{{dataSource.dmPricePreset.data.perc_max}}</div>
      <div class="g-ce g-co2">{{dataSource.dmPricePreset.data.perc_nor}}</div>
      <div class="g-ce g-co3">{{dataSource.dmPricePreset.data.perc_min}}</div>
      <div class="g-ce g-co4">{{dataSource.dmPricePreset.data.perc_ekv}}</div>
      <div class="g-ce g-co5">{{dataSource.dmPricePreset.data.perc_mil}}</div>
      <div class="g-ce g-co6">{{dataSource.dmPricePreset.data.sum_obtain}}</div>
      <div class="g-ce g-co7">{{dataSource.dmPricePreset.data.sum_pack}}</div>
    </div>

    <div class="params">
      <div>
        Показывать строк: <select v-model="dataSource.dmPrice!.limit">
          <option
            :key="option"
            v-for="option in dataSource.dmPrice?.limitValues"
            :value="option"
          >
            {{option}}
          </option>
        </select>
      </div>

      <div>
        Фильтр по видимости: <select v-model="dataSource.dmPrice!.visibility.value">
          <option :value="undefined">Все типы</option>
          <option
            :key="option"
            v-for="option in Object.keys(dataSource.dmVisibility!.data)"
            :value="option"
          >
            {{dataSource.dmPrice?.getAliasByVisibility(option)}}
          </option>
        </select>
        ({{dataSource.dmPrice!.visibility.value ?? '--'}})
      </div>

      <div class="codes">
        Наш код: <span>
          <template :key="ind" v-for="(id, ind) in dataSource.dmPrice!.offer_id.value">
            <input v-model="dataSource.dmPrice!.offer_id.value[ind]">
            <button class="item-minus" type="button" @click="dataSource.dmPrice!.offer_id.value.splice(ind, 1)">-</button>
          </template>
        </span>
        <button type="button" @click="dataSource.dmPrice!.offer_id.value.push('')">+</button>
      </div>

      <div class="codes">
        Код Озон: <span>
          <template :key="ind" v-for="(id, ind) in dataSource.dmPrice!.product_id.value">
            <input v-model="dataSource.dmPrice!.product_id.value[ind]">
            <button class="item-minus" type="button" @click="dataSource.dmPrice!.product_id.value.splice(ind, 1)">-</button>
          </template>
        </span>
        <button type="button" @click="dataSource.dmPrice!.product_id.value.push(undefined)">+</button>
      </div>

      <div class="get-data">
        <button :disabled="dataSource.dmPrice?.isLoading.value" @click="dataSource.dmPrice?.getData()" type="button">ПОКАЗАТЬ</button>
      </div>

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
        <div class="g-ce g-co1" title="Код Озон">
          <div>{{item.data.product_id}}</div>
          <div class="save-button">
            <button :disabled="!item.percentChanged.value" type="button" @click="item.savePercent()">Сохр. %</button>
          </div>
        </div>
        <div class="g-ce g-co2" title="Наш код">
          <div>{{item.data.offer_id}}</div>
          <div class="save-button">
            <button :disabled="!item.priceChanged.value" type="button" @click="item.savePrice()">Сохр. $</button>
          </div>
        </div>
        <div class="g-ce g-co3" title="Наименование">{{item.data.name}}</div>
        <div class="g-ce g-co4" title="Цена покупателю">{{rounding(item.data.marketing_price)}}</div>
        <div class="g-ce g-co5" title="Цена расч">{{rounding(item.data.marketing_seller_price)}}</div>
        <div class="g-ce g-co6" title="Выплата">
          <div title="тек" :class="{calc: true, chan: item.currentPayment.isProcessedChanged}">{{item.currentPayment.processed}}</div>
          <div title="расч" :class="{calc: true, chan: item.calculatedPayment.isProcessedChanged}">{{item.calculatedPayment.processed}}</div>
        </div>
        <div class="g-ce g-co7" title="Вх.цена">{{rounding(item.data.incoming_price)}}</div>
        <div class="g-ce g-co8" title="Max">
          <div title="тек цена">{{rounding(item.data.old_price)}}</div>
          <div title="расч цена" :class="{calc: true, chan: item.maxCalculated.isProcessedChanged}">{{item.maxCalculated.processed}}</div>
          <div title="процент">
            <input type="number" size="5" v-model="item.e_old_perc.value">
          </div>
        </div>
        <div class="g-ce g-co9" title="Норм">
          <div title="тек цена">{{rounding(item.data.price)}}</div>
          <div title="расч цена" :class="{calc: true, chan: item.normCalculated.isProcessedChanged}">{{item.normCalculated.processed}}</div>
          <div title="процент">
            <input type="number" v-model="item.e_perc.value">
          </div>
        </div>
        <div class="g-ce g-co10" title="Мин">
          <div title="тек цена">{{rounding(item.data.min_price)}}</div>
          <div title="расч цена" :class="{calc: true, chan: item.minCalculated.isProcessedChanged}">{{item.minCalculated.processed}}</div>
          <div title="процент">
            <input type="number" v-model="item.e_min_perc.value">
          </div>
        </div>
        <div class="g-ce g-co11" title="Комис">
          <div title="тек сум">{{item.currentCom()}}</div>
          <div title="рас сум" :class="{calc: true, chan: item.comCalculated.isProcessedChanged}">{{item.comCalculated.processed}}</div>
          <div title="процент">{{item.data.sales_percent}}</div>
        </div>
        <div class="g-ce g-co12" title="Логист">
          <div title=""></div>
          <div title="сумма">{{item.data.fbs_direct_flow_trans_max_amount}}</div>
          <div title=""></div>
        </div>
        <div class="g-ce g-co13" title="Реклама">
          <div title="тек">{{item.currentRek()}}</div>
          <div title="расч" :class="{calc: true, chan: item.rekCalculated.isProcessedChanged}">{{item.rekCalculated.processed}}</div>
          <div title="процент">
            <input type="number" v-model.number="item.e_adv_perc.processed" step="" min="0" max="100">
          </div>
        </div>
        <div class="g-ce g-co14" title="#">
          {{ind+1}}
        </div>
      </template>
    </div>

    <div v-if="dataSource.dmPrice?.isLoading.value">загружается...</div>

    <div class="get-data">
      <button :disabled="dataSource.dmPrice?.isLoading.value" v-if="(dataSource.dmPrice?.data?.length ?? 0) > 0" @click="dataSource.dmPrice?.getNext()" type="button">ЕЩЁ</button>
    </div>
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
  max-width: 800px;
  overflow-x: scroll;
  grid-template-columns: repeat(7, 1fr);
}
.grid-pri {
  max-width: 100%;
  overflow-x: scroll;
  grid-template-columns: repeat(14, 1fr);
  input {
    max-width: 75px;
  }
  .calc {
    background-color: var(--calculated-background);
    padding: 3px 5px;
    border-radius: 5px;
    border: solid 1px var(--transparent);
  }
  .chan {
    border: solid 1px var(--changed-border-color);
  }
  .g-ce > div {
    margin-bottom: 5px;
  }
}

.params {
  > div {
    margin-bottom: 10px;
  }
  select {
    font-size: 20px;
  }
}

.get-data {
  margin: 30px 0 10px 0;
  text-align: center;
  button {
    padding: 10px 20px;
    width: 50%;
    font-size: 20px;
  }
}

.item-minus {
  margin-right: 20px;
}

.save-button {
  margin-top: 20px;
  white-space: nowrap;
}


</style>
